// pumpfun_sell.ts

import { Commitment, Connection, Finality, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { PriorityFee, TransactionResult } from "../../services/Trading.service";
import { getTokenBondingCurveAccount, PUMPFUN_PROGRAM_ID } from "./pumpfun_create_buy_sell";
import { DEFAULT_COMMITMENT, DEFAULT_FINALITY, sendTx, simulateTransaction } from "./pumpfun_tx";
import { getGlobalAccount } from "./pumpfun_global_account";
import { calculateWithSlippageSell } from "./pumpfun_create_buy_sell";
import { getBondingCurvePDA } from "./pumpfun_bondingcurve_account";


/* ######################################################### */



export async function pumpFunSell(
    connection: Connection,
    seller: Keypair,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY
): Promise<TransactionResult> {

    console.log(`🔄 Préparation de la vente de token ${mint.toBase58()} pour ${Number(sellTokenAmount) / 1e6} tokens`);

    // Déterminer le programme de token approprié
    //const tokenProgramId = TOKEN_2022_PROGRAM_ID; //await getTokenProgramId(connection, mint);
    //console.log(`💱 Programme de token détecté pour ${mint.toBase58()}: ${tokenProgramId.toBase58()}`);


    // 1) Créer la transaction
    let sellTx = await getSellTransactionByTokenAmount(
        connection,
        seller.publicKey,
        mint,
        sellTokenAmount,
        slippageBasisPoints,
        commitment
    );


    // 2) Effectuer la simulation de transaction avant l'envoi
    const simulation = await simulateTransaction(connection, sellTx, seller.publicKey);

    if (!simulation) {
        // Annuler ou ajuster la transaction
        throw new Error(`Sell simulation failed`);
    }


    // 3) Envoi de la transaction
    let sellResult = await sendTx(
        connection,
        sellTx,
        seller.publicKey,
        [seller],
        priorityFees,
        commitment,
        finality
    );


    // 4) Analyse du résultat
    if (sellResult.success) {
        console.log(`✅ Transaction de vente réussie: ${sellResult.signature}`);

    } else {
        console.error(`❌ La transaction d'achat a échoué:`, sellResult.error);
    }

    return sellResult;
}




//sell
async function getSellTransactionByTokenAmount(
    connection: Connection,
    seller: PublicKey,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = DEFAULT_COMMITMENT
): Promise<Transaction> {
    let bondingCurveAccount = await getTokenBondingCurveAccount(
        connection,
        mint,
        commitment
    );
    if (!bondingCurveAccount) {
        throw new Error(`[sell failed] Bonding curve account not found: ${mint.toBase58()}`);
    }

    let globalAccount = await getGlobalAccount(connection, commitment);

    let minSolOutput = bondingCurveAccount.getSellPrice(
        sellTokenAmount,
        globalAccount.feeBasisPoints
    );

    let sellAmountWithSlippage = calculateWithSlippageSell(
        minSolOutput,
        slippageBasisPoints
    );

    const transaction: Transaction = await getSellInstructions(
        seller,
        mint,
        globalAccount.feeRecipient,
        sellTokenAmount,
        sellAmountWithSlippage
    );

    return transaction;
}


async function getSellInstructions(
    seller: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    minSolOutput: bigint
): Promise<Transaction> {
    // Get the token program ID for this mint
    //const programId = program.programId;
    const tokenProgramId = TOKEN_2022_PROGRAM_ID; //await getTokenProgramId(connection, mint);
    console.log(`Using token program ID for sell: ${tokenProgramId.toBase58()} for mint: ${mint.toBase58()}`);

    // Get the bonding curve PDA
    const bondingCurvePDA = getBondingCurvePDA(mint);

    // Get the associated bonding curve token account
    const associatedBondingCurve = await getAssociatedTokenAddress(mint, bondingCurvePDA, true, TOKEN_PROGRAM_ID);

    // Get the user's associated token account
    const associatedUser = await getAssociatedTokenAddress(mint, seller, false, tokenProgramId);

    // Create the transaction
    let transaction = new Transaction();


    // Créer l'instruction manuellement avec les bons programmes
    const sellInstruction: TransactionInstruction = preparePumpFunSellInstruction(
        feeRecipient,
        mint,
        bondingCurvePDA,
        associatedBondingCurve,
        associatedUser,
        seller,
        amount,
        minSolOutput,
        tokenProgramId // Passer le programme de token détecté
    );

    //const sellInstruction = await program.methods
    //    .sell(new BN(amount.toString()), new BN(minSolOutput.toString()))
    //    .accounts({
    //        feeRecipient: feeRecipient,
    //        mint: mint,
    //        associatedBondingCurve: associatedBondingCurve,
    //        associatedUser: associatedUser,
    //        user: seller,
    //    })
    //    .transaction();


    // Add sell instruction
    transaction.add(
        sellInstruction
    );

    return transaction;
}



function preparePumpFunSellInstruction(
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

    // Identifiant de l'instruction sell
    const INSTRUCTION_IDENTIFIER = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);


    // Préparer les tampons pour l'amount et le slippage
    const tokenAmountBuffer = Buffer.alloc(8);
    tokenAmountBuffer.writeBigUInt64LE(amount, 0);

    const solAmountBuffer = Buffer.alloc(8);
    solAmountBuffer.writeBigUInt64LE(solAmount, 0);


    // Concaténer les données de l'instruction
    const instructionData = Buffer.concat([
        INSTRUCTION_IDENTIFIER,
        tokenAmountBuffer,
        solAmountBuffer
    ]);


    const globalAccount = PublicKey.findProgramAddressSync(
        [Buffer.from("global")],
        new PublicKey(PUMPFUN_PROGRAM_ID)
    )[0];

    console.log(`🌐 Compte global: ${globalAccount.toBase58()}`);


    // Liste des comptes requis
    const keys = [
        { pubkey: globalAccount, isSigner: false, isWritable: false },
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


