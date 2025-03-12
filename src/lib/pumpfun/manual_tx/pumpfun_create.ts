// pumpfun_create_versioned.ts

import { Commitment, Connection, Finality, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, createInitializeMintInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { PriorityFee, sendVersionedTransaction, TransactionResult } from "../../solana/solana_tx_sender";
import { DEFAULT_COMMITMENT, FEE_RECIPIENT, METADATA_SEED, PUMPFUN_PROGRAM_ID } from "../pumpfun_config";
import { getGlobalAccount } from "../pumpfun_global_account";
import { getBuyInstructions } from "./pumpfun_buy";
import { getBondingCurvePDA } from "../pumpfun_bondingcurve_account";
import { calculateWithSlippageBuy } from "../pumpfun_trading";
import { createTokenMetadata, CreateTokenMetadata } from "../pumpfun_token_metadata";




/* ######################################################### */

export type TransactionError = Error & { transactionError?: Error, transactionLogs?: string[], transactionMessage?: string };


export type TokenCreationMetadata = {
    name: string,
    symbol: string,
    uri: string
};

/* ######################################################### */



export async function pumpFunCreateAndBuy(
    connection: Connection,
    creator: Keypair,
    mint: Keypair,
    newTokenMetadata: CreateTokenMetadata,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT
): Promise<TransactionResult> {
    try {
        // 1. Obtenir les métadonnées du token
        let tokenMetadata = await createTokenMetadata(newTokenMetadata);


        // 2. Créer la transaction standard
        const transaction = new Transaction();


        // 3. Ajouter les priorités de calcul si spécifiées
        if (priorityFees) {
            transaction.add(
                ComputeBudgetProgram.setComputeUnitLimit({
                    units: 200000 // priorityFees.unitLimit
                })
            );

            transaction.add(
                ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: 2000000 // priorityFees.unitPrice
                })
            );
        }


        // 4. Obtenir les instructions de création
        const createTx = await getCreateInstructions(
            connection,
            creator.publicKey,
            newTokenMetadata.name,
            newTokenMetadata.symbol,
            tokenMetadata.metadataUri,
            mint
        );

        // 5. Ajouter les instructions de création
        //for (const instruction of createTx.instructions) {
        //    transaction.add(instruction);
        //}
        transaction.add(createTx);


        // 6. Ajouter l'instruction d'achat si nécessaire
        if (buyAmountSol > 0) {
            const globalAccount = await getGlobalAccount(connection, commitment);
            if (! globalAccount) throw new Error(`globalAccount manquant`);

            const buyAmount = globalAccount.getInitialBuyPrice(buyAmountSol);
            const buyAmountWithSlippage = calculateWithSlippageBuy(
                buyAmountSol,
                slippageBasisPoints
            );

            const buyTx = await getBuyInstructions(
                connection,
                creator.publicKey,
                mint.publicKey,
                FEE_RECIPIENT,
                buyAmount,
                buyAmountWithSlippage,
                DEFAULT_COMMITMENT,
                true
            );

            // Ajouter les instructions d'achat
            //for (const instruction of buyTx.instructions) {
            //    transaction.add(instruction);
            //}
            transaction.add(buyTx);
        }


        // 7. Obtenir le dernier blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
        //transaction.recentBlockhash = blockhash;
        //transaction.feePayer = creator.publicKey;


        // Après avoir ajouté toutes les instructions
        console.log("Instructions dans la transaction:");
        transaction.instructions.forEach((inst, i) => {
            console.log(`Instruction ${i}: programId=${inst.programId.toBase58()}`);
        });

        //throw new Error('debug')


        // 8. Convertir en transaction versionnée
        const messageV0 = new TransactionMessage({
            payerKey: creator.publicKey,
            recentBlockhash: blockhash,
            instructions: transaction.instructions
        }).compileToV0Message();

        const versionedTransaction = new VersionedTransaction(messageV0);
        versionedTransaction.sign([creator, mint]);


        // 9. Ajouter les signatures (pas ici, mais dans sendVersionedTransaction)
        // Note: nous n'ajoutons pas les signatures ici car votre fonction sendVersionedTransaction le fait déjà

        // 10. Envoyer la transaction versionnée
        versionedTransaction.sign([creator]);
        return await sendVersionedTransaction(connection, versionedTransaction);

    } catch (err: any) {
        console.error(`❌ Erreur dans pumpFunCreateAndBuyVersioned:`, err);
        const error: TransactionError = new Error(String(err));
        return {
            success: false,
            error
        };
    }
}

// Fonction getCreateInstructions améliorée qui renvoie une transaction avec toutes les instructions nécessaires
async function getCreateInstructions(
    connection: Connection,
    creator: PublicKey,
    name: string,
    symbol: string,
    uri: string,
    mint: Keypair,
    commitment: Commitment = DEFAULT_COMMITMENT
): Promise<Transaction> {
    // 1. Créer une transaction
    const transaction = new Transaction();

    // 2. Créer le compte Mint
    transaction.add(
        SystemProgram.createAccount({
            fromPubkey: creator,
            newAccountPubkey: mint.publicKey,
            space: 82,
            lamports: await connection.getMinimumBalanceForRentExemption(82, commitment),
            programId: TOKEN_PROGRAM_ID
        })
    );

    // 3. Initialiser le Mint
    transaction.add(
        createInitializeMintInstruction(
            mint.publicKey,
            6,
            creator,
            null,
            TOKEN_PROGRAM_ID
        )
    );

    // 4. Générer les adresses nécessaires
    const mplTokenMetadata = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID);
    const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from(METADATA_SEED),
            mplTokenMetadata.toBuffer(),
            mint.publicKey.toBuffer(),
        ],
        mplTokenMetadata
    );

    const bondingCurvePDA = getBondingCurvePDA(mint.publicKey);
    const associatedBondingCurve = await getAssociatedTokenAddress(
        mint.publicKey,
        bondingCurvePDA,
        true,
        TOKEN_PROGRAM_ID
    );

    // 5. Créer l'ATA pour la bonding curve
    transaction.add(
        createAssociatedTokenAccountInstruction(
            creator,
            associatedBondingCurve,
            bondingCurvePDA,
            mint.publicKey,
            TOKEN_PROGRAM_ID
        )
    );

    // 6. Ajouter l'instruction de création Pump.fun
    transaction.add(
        preparePumpFunCreateInstruction(
            FEE_RECIPIENT,
            mint,
            associatedBondingCurve,
            creator,
            metadataPDA,
            name,
            symbol,
            uri,
            TOKEN_PROGRAM_ID
        )
    );

    return transaction;
}



export function preparePumpFunCreateInstruction(
    feeRecipient: PublicKey,
    mint: Keypair,
    associatedBondingCurve: PublicKey,
    creator: PublicKey,
    metadataPDA: PublicKey,
    name: string,
    symbol: string,
    uri: string,
    tokenProgramId: PublicKey = TOKEN_PROGRAM_ID
): TransactionInstruction {
    // Identifiant de l'instruction create (correspond au discriminator dans l'IDL)
    const INSTRUCTION_IDENTIFIER = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

    // Encoder les chaînes en format Anchor
    const nameBuffer = Buffer.from(name);
    const nameLength = Buffer.alloc(4);
    nameLength.writeUInt32LE(nameBuffer.length, 0);

    const symbolBuffer = Buffer.from(symbol);
    const symbolLength = Buffer.alloc(4);
    symbolLength.writeUInt32LE(symbolBuffer.length, 0);

    const uriBuffer = Buffer.from(uri);
    const uriLength = Buffer.alloc(4);
    uriLength.writeUInt32LE(uriBuffer.length, 0);

    // Concaténer les données de l'instruction
    const instructionData = Buffer.concat([
        INSTRUCTION_IDENTIFIER,
        nameLength,
        nameBuffer,
        symbolLength,
        symbolBuffer,
        uriLength,
        uriBuffer
    ]);

    // Obtenir les seeds pour le mint_authority PDA
    const mintAuthority = PublicKey.findProgramAddressSync(
        [Buffer.from("mint-authority")],
        new PublicKey(PUMPFUN_PROGRAM_ID)
    )[0];

    // Obtenir le bondingCurvePDA
    const bondingCurvePDA = getBondingCurvePDA(mint.publicKey);

    // Obtenir le globalAccount PDA
    const globalAccountPDA = PublicKey.findProgramAddressSync(
        [Buffer.from("global")],
        new PublicKey(PUMPFUN_PROGRAM_ID)
    )[0];

    // L'autorité d'événement est une adresse fixe déclarée dans l'IDL
    const eventAuthority = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");

    // Liste des comptes exactement comme spécifié dans l'IDL
    const keys = [
        { pubkey: mint.publicKey, isSigner: true, isWritable: true },
        { pubkey: mintAuthority, isSigner: false, isWritable: false },
        { pubkey: bondingCurvePDA, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: globalAccountPDA, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID), isSigner: false, isWritable: false },
        { pubkey: metadataPDA, isSigner: false, isWritable: true },
        { pubkey: creator, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(PUMPFUN_PROGRAM_ID), isSigner: false, isWritable: false }
    ];

    return new TransactionInstruction({
        keys,
        programId: new PublicKey(PUMPFUN_PROGRAM_ID),
        data: instructionData
    });
}

