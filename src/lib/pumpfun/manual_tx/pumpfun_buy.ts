// pumpfun_buy.ts

import { Commitment, Connection, Finality, Keypair, PublicKey, VersionedTransactionResponse, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY, SendTransactionError } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, getAccount, getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { sleep } from "../../utils/time.util";
import { PriorityFee, sendTransaction, TransactionResult } from "../../solana/solana_tx_sender";
import { DEFAULT_COMMITMENT, DEFAULT_FINALITY, FEE_RECIPIENT, PUMPFUN_PROGRAM_ID } from "../pumpfun_config";
import { simulateTransaction } from "../pumpfun_tx_simulation";
import { getBondingCurvePDA, getTokenBondingCurveAccount } from "../pumpfun_bondingcurve_account";
import { getGlobalAccountPDA } from "../pumpfun_global_account";
import { calculateWithSlippageBuy } from "../pumpfun_trading";

/* ######################################################### */


// WARNING : code non fonctionnel. a debuger => les transactions échouent (probleme de programId)


export async function pumpFunBuy(
    connection: Connection,
    buyer: Keypair,
    mint: PublicKey,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY
): Promise<TransactionResult> {

    try {
        console.log(`🔄 Préparation de l'achat de token ${mint.toBase58()} pour ${Number(buyAmountSol) / 1e9} SOL...`);

        // Déterminer le programme de token approprié
        //const tokenProgramId = TOKEN_2022_PROGRAM_ID; //await getTokenProgramId(connection, mint);
        //console.log(`💱 Programme de token détecté pour ${mint.toBase58()}: ${tokenProgramId.toBase58()}`);


        // 1) Créer la transaction
        let buyTx = await getBuyTransactionBySolAmount(
            connection,
            buyer.publicKey,
            mint,
            buyAmountSol,
            slippageBasisPoints,
            commitment
        );


        // 2) Effectuer la simulation de transaction avant l'envoi
        console.log(`🔍 Simulation de la transaction d'achat...`);
        const simulation = await simulateTransaction(connection, buyTx, buyer.publicKey, commitment);

        if (!simulation) {
            throw new Error(`La simulation d'achat a échoué`);
        }

        // Ajouter des priority fees si spécifié
        if (priorityFees) {
            console.log(`💰 Ajout de frais prioritaires: ${priorityFees.unitPrice} microlamports × ${priorityFees.unitLimit} unités`);
        }


        // 3) Envoi de la transaction
        console.log("Buy simulation successful, sending transaction...");

        let buyResult = await sendTransaction(
            connection,
            buyTx,
            buyer.publicKey,
            [buyer],
            priorityFees,
            commitment,
            finality
        );



        // 4) Analyse du résultat
        if (buyResult.success) {
            console.log(`✅ Transaction d'achat réussie: ${buyResult.signature}`);

        } else {
            console.error(`❌ La transaction d'achat a échoué:`, buyResult.error);
        }

        return buyResult;

    } catch (err: any) {
        console.error(`❌ Erreur dans pumpFunBuy:`, err);

        // Fournir un message d'erreur plus descriptif
        const errorMessage = err instanceof Error ? err.message : String(err);


        const errMessage = errorMessage.includes("simulation")
            ? `Erreur de simulation: ${errorMessage}`
            : `Erreur d'achat: ${errorMessage}`;

        const error = new SendTransactionError({ action: 'send', signature: '', transactionMessage: errMessage, logs: [] });

        return {
            success: false,
            error
        };
    }
}





async function getBuyTransactionBySolAmount(
    connection: Connection,
    buyer: PublicKey,
    mint: PublicKey,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = DEFAULT_COMMITMENT
) {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError = null;

    while (attempts < maxAttempts) {
        try {
            let bondingCurveAccount = await getTokenBondingCurveAccount(
                connection,
                mint,
                commitment
            );

            if (!bondingCurveAccount) {
                console.log(`Bonding curve not found, waiting 500ms before retry (attempt ${attempts + 1}/${maxAttempts})`);
                await sleep(500);

                bondingCurveAccount = await getTokenBondingCurveAccount(
                    connection,
                    mint,
                    commitment
                );

                if (!bondingCurveAccount) {
                    if (attempts >= maxAttempts - 1) {
                        throw new Error(`[buy failed] Bonding curve account not found: ${mint.toBase58()}`);
                    }
                    attempts++;
                    continue;
                }
            }

            let buyAmount = bondingCurveAccount.getBuyPrice(buyAmountSol);
            let buyAmountWithSlippage = calculateWithSlippageBuy(
                buyAmountSol,
                slippageBasisPoints
            );

            //const globalAccount = await getGlobalAccount(connection, commitment);
            //const globalAccountPubKey = globalAccount.feeRecipient;
            const globalAccountPubKey = FEE_RECIPIENT; //getGlobalAccountPubKey();

            return await getBuyInstructions(
                connection,
                buyer,
                mint,
                globalAccountPubKey,
                buyAmount,
                buyAmountWithSlippage,
                commitment
            );

        } catch (error) {
            lastError = error;
            attempts++;
            console.log(`Error getting buy instructions (attempt ${attempts}/${maxAttempts}):`, error);

            if (attempts >= maxAttempts) {
                throw lastError;
            }

            // Wait before retry
            await sleep(200);
        }
    }

    // Should never reach here, but TypeScript needs a return
    throw lastError || new Error('Failed to get buy instructions after multiple attempts');
}


//buy
export async function getBuyInstructions(
    connection: Connection,
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    solAmount: bigint,
    commitment: Commitment = DEFAULT_COMMITMENT,
    skipSimulation = false
) {
    try {
        // Inférer le programme de token pour ce mint
        const tokenProgramId = TOKEN_2022_PROGRAM_ID; //await inferTokenProgram(connection, mint, commitment);
        //console.log(`💱 Programme de token inféré: ${tokenProgramId.toBase58()} pour ${mint.toBase58()}`);


        // Pour les bonding curves, utiliser toujours le programme TOKEN
        const bondingCurvePDA = getBondingCurvePDA(mint);
        console.log(`🔄 Bonding curve PDA: ${bondingCurvePDA.toBase58()}`);

        // Les bonding curves utilisent toujours TOKEN_PROGRAM_ID
        const associatedBondingCurve = await getAssociatedTokenAddress(
            mint,
            bondingCurvePDA,
            true,
            TOKEN_PROGRAM_ID // Toujours standard SPL pour la bonding curve
        );
        console.log(`📦 Adresse de la bonding curve: ${associatedBondingCurve.toBase58()}`);


        // Pour l'ATA de l'utilisateur, utiliser le même programme que celui du mint
        const associatedUser = await getAssociatedTokenAddress(
            mint,
            buyer,
            false,
            tokenProgramId
        );
        console.log(`👤 Adresse du compte utilisateur: ${associatedUser.toBase58()}`);


        let transaction = new Transaction();

        // Vérifier si l'ATA de l'utilisateur existe déjà
        try {
            await getAccount(connection, associatedUser, commitment);
            console.log(`✅ Le compte de token de l'utilisateur existe déjà`);

        } catch (e) {
            console.log(`⏳ Création du compte de token pour l'utilisateur avec le programme: ${tokenProgramId.toBase58()}`);

            // Créer l'ATA
            transaction.add(
                createAssociatedTokenAccountInstruction(
                    buyer,
                    associatedUser,
                    buyer,
                    mint,
                    tokenProgramId
                )
            );
        }

        // Maintenant, préparons l'instruction d'achat
        console.log(`💰 Préparation de l'instruction d'achat pour ${Number(amount) / 1e6} tokens`);

        // Créer l'instruction manuellement avec les bons programmes
        const buyInstruction = preparePumpFunBuyInstruction(
            feeRecipient,
            mint,
            bondingCurvePDA,
            associatedBondingCurve,
            associatedUser,
            buyer,
            amount,
            solAmount,
            tokenProgramId // Passer le programme de token détecté
        );

        //const buyInstruction = await program.methods
        //    .buy(new BN(amount.toString()), new BN(solAmount.toString()))
        //    .accounts({
        //        feeRecipient,
        //        mint,
        //        associatedBondingCurve,
        //        associatedUser,
        //        user: buyer,
        //        tokenProgram: TOKEN_PROGRAM_ID,
        //    })
        //    .transaction()

        transaction.add(buyInstruction);
        console.log(`📝 Transaction d'achat préparée avec ${transaction.instructions.length} instructions`);

        if (!skipSimulation) {
            // Simuler la transaction avant de la renvoyer
            const simuResult = await simulateTransaction(connection, transaction, buyer, commitment);
            if (!simuResult) {
                console.error(`❌ La simulation a échoué, mais on continue pour déboguer`);
            }
        }

        return transaction;

    } catch (error) {
        console.error(`❌ Erreur dans getBuyInstructions:`, error);
        throw error;
    }
}



function preparePumpFunBuyInstruction(
    feeRecipient: PublicKey,
    mint: PublicKey,
    bondingCurve: PublicKey,
    associatedBondingCurve: PublicKey,
    associatedUser: PublicKey,
    user: PublicKey,
    amount: bigint,
    solAmount: bigint,
    tokenProgramId: PublicKey = TOKEN_PROGRAM_ID
): TransactionInstruction {
    console.log(`🔧 Préparation manuelle de l'instruction d'achat...`);
    console.log(`💰 Montant de tokens: ${Number(amount) / 1e6}, Montant SOL: ${Number(solAmount) / 1e9}`);
    console.log(`🔑 Utilisation du programme de token: ${tokenProgramId.toBase58()}`);

    // Identifiant de l'instruction buy
    //const INSTRUCTION_IDENTIFIER = Buffer.from('66063d1201daebea', 'hex');
    const INSTRUCTION_IDENTIFIER = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);


    // Préparer les tampons pour l'amount et le slippage
    const tokenAmountBuffer = Buffer.alloc(8);
    tokenAmountBuffer.writeBigUInt64LE(amount, 0);

    const solAmountBuffer = Buffer.alloc(8);
    solAmountBuffer.writeBigUInt64LE(solAmount, 0); // maxSolCost


    // Concaténer les données de l'instruction
    const instructionData = Buffer.concat([
        INSTRUCTION_IDENTIFIER,
        tokenAmountBuffer,
        solAmountBuffer
    ]);


    const globalAccountPubKey = getGlobalAccountPDA();

    //const globalAccountPubKey = PublicKey.findProgramAddressSync(
    //    [Buffer.from("global")],
    //    new PublicKey(PUMPFUN_PROGRAM_ID)
    //)[0];

    console.log(`🌐 Compte global: ${globalAccountPubKey.toBase58()}`);


    // Liste des comptes requis
    const keys = [
        { pubkey: globalAccountPubKey, isSigner: false, isWritable: false },
        { pubkey: feeRecipient, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedUser, isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Pour les bonding curves
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },   // Pour les opérations de token de l'utilisateur
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ];

    console.log(`📑 Liste des comptes préparée avec ${keys.length} comptes`);

    return new TransactionInstruction({
        keys,
        programId: new PublicKey(PUMPFUN_PROGRAM_ID), // Adresse du programme Pump.fun
        data: instructionData
    });
}






