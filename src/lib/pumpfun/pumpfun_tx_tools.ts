// pumpfun_tx_tools.ts

import { Commitment, ComputeBudgetProgram, Connection, Finality, Keypair, Message, MessageV0, ParsedTransactionWithMeta, PublicKey, SendTransactionError, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, VersionedTransactionResponse } from "@solana/web3.js";
import { DEFAULT_COMMITMENT, DEFAULT_FINALITY } from "./pumpfun_config";
import { retryAsync } from "../utils/promise.util";
import base58 from "bs58";

/* ######################################################### */


export async function buildVersionedTransaction(
    connection: Connection,
    payer: PublicKey,
    tx: Transaction,
    commitment: Commitment = DEFAULT_COMMITMENT,
    explicitBlockhash?: string
): Promise<VersionedTransaction> {

    // 1) Récupérer les dernier blockhash connu
    const blockHash = explicitBlockhash ||
        (await connection.getLatestBlockhash(commitment)).blockhash;

    // 2) Convertir les intructions en messageV0
    let messageV0 = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockHash,
        instructions: tx.instructions,
    }).compileToV0Message();

    // 3) Convertir le message en VersionedTransaction
    const versionedTransaction = new VersionedTransaction(messageV0);

    return versionedTransaction;
};


export function buidVersionedMessageFromResponse(version: number | 'legacy', message: Message): Message | MessageV0 {
    const accountKeys = message.accountKeys.map((accountKey: any) => new PublicKey(accountKey.pubkey));

    if (version === 0) {
        return new MessageV0({
            header: message.header,
            staticAccountKeys: accountKeys,
            recentBlockhash: message.recentBlockhash,
            compiledInstructions: message.instructions.map(ix => ({
                programIdIndex: ix.programIdIndex,
                accountKeyIndexes: ix.accounts,
                data: ix.data ? base58.decode(ix.data) : Buffer.from(''),
            })),
            addressTableLookups: message.addressTableLookups
        });

    } else {
        const messageFormatted = {
            ...message,
            accountKeys,
        };
        return new Message(messageFormatted);
    }
}



export const fetchTransactionResponse = async (
    connection: Connection,
    sig: string,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY
): Promise<VersionedTransactionResponse | null> => {

    const latestBlockHash = await connection.getLatestBlockhash();

    await connection.confirmTransaction(
        {
            blockhash: latestBlockHash.blockhash,
            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
            signature: sig,
        },
        commitment
    );

    return connection.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: finality,
    });
};



export const fetchParsedTransactionWithRetries = async (connection: Connection, signature: string, onRetry?: (attempt: number, elapsedMs: number) => void) => {
    const parsedTransaction = await retryAsync(
        async () => {
            const tx = await connection.getParsedTransaction(
                signature,
                { maxSupportedTransactionVersion: 0, commitment: "confirmed" }
            );

            if (!tx) {
                throw new Error('Transaction non trouvée');
            }

            return tx;
        },
        1_000,  // Réessayer toutes les 1 secondes
        30_000, // Timeout après 30 secondes
        onRetry
    );

    return parsedTransaction;
};




// Fonction pour vérifier si l'erreur est fatale
export function isTransactionFatalError(error: any): boolean {
    const errorStr = String(error);

    return errorStr.includes("insufficient funds") ||
        errorStr.includes("TooMuchSolRequired");
}

