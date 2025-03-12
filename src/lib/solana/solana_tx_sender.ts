// solana_tx_sender.ts

import { Commitment, ComputeBudgetProgram, Connection, Finality, Keypair, PublicKey, SendTransactionError, Transaction, VersionedTransaction, VersionedTransactionResponse } from "@solana/web3.js";

import { DEFAULT_COMMITMENT, DEFAULT_FINALITY } from "../pumpfun/pumpfun_config";
import { buildVersionedTransaction, fetchTransactionResponse, isTransactionFatalError } from "../pumpfun/pumpfun_tx_tools";

/* ######################################################### */


export type TransactionResult = {
    signature?: string;
    error?: SendTransactionError | Error;
    results?: VersionedTransactionResponse;
    success: boolean;
};


export type PriorityFee = {
    unitLimit: number;
    unitPrice: number;
};


/* ######################################################### */


export async function sendVersionedTransaction(connection: Connection, tx: VersionedTransaction, options?: { skipPreflight: false }) {
    let success = false;
    let error = undefined;

    // Envoi de la transaction
    const signature = await connection.sendTransaction(tx, {
        skipPreflight: options?.skipPreflight ?? false,
        maxRetries: 3, // Autoriser des retries au niveau de l'API
        preflightCommitment: 'confirmed',
    })
        .then((result) => {
            success = true;
            return result;
        })
        .catch((err: any) => {
            error = err;
            //console.warn(`sendPortalTransaction error. ${err.message}`);
            return undefined;
        })

    //console.log("Transaction: https://solscan.io/tx/" + signature);

    const result: TransactionResult = {
        success,
        signature,
        error,
    };

    return result;
}



export async function sendTransaction(
    connection: Connection,
    tx: Transaction,
    payer: PublicKey,
    signers: Keypair[],
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY
): Promise<TransactionResult> {
    let newTx = new Transaction();

    if (priorityFees) {
        const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
            units: priorityFees.unitLimit,
        });

        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFees.unitPrice,
        });
        newTx.add(modifyComputeUnits);
        newTx.add(addPriorityFee);
    }

    newTx.add(tx);

    let versionedTx = await buildVersionedTransaction(connection, payer, newTx, commitment);
    versionedTx.sign(signers);


    // Nombre de tentatives maximum en cas d'échec
    const MAX_RETRIES = 5;
    let attempts = 0;


    while (attempts < MAX_RETRIES) {
        // Si ce n'est pas la première tentative, attendez un peu
        if (attempts > 0) {
            await new Promise(resolve => setTimeout(resolve, 200));
            console.log(`Tentative ${attempts + 1}/${MAX_RETRIES}...`);
        }


        // Obtenir un nouveau blockhash à chaque tentative
        const blockhash = await connection.getLatestBlockhash(commitment);

        let versionedTx = await buildVersionedTransaction(
            connection,
            payer,
            newTx,
            commitment,
            blockhash.blockhash // Passer explicitement le blockhash
        );
        versionedTx.sign(signers);

        const signature = await connection.sendTransaction(versionedTx, {
            skipPreflight: false,
            maxRetries: 3, // Autoriser des retries au niveau de l'API
            preflightCommitment: commitment
        });

        console.log("Transaction: https://solscan.io/tx/" + signature);


        try {
            // Attendre la confirmation avec le blockhash spécifique que nous avons utilisé
            await connection.confirmTransaction({
                signature,
                blockhash: blockhash.blockhash,
                lastValidBlockHeight: blockhash.lastValidBlockHeight
            }, commitment);


            let txResult = await fetchTransactionResponse(connection, signature, commitment, finality);
            if (!txResult) {
                const error: SendTransactionError = new SendTransactionError({ action: 'send', signature: signature, transactionMessage: '', logs: [] });

                return {
                    success: false,
                    error,
                    signature
                };
            }

            return {
                success: true,
                signature: signature,
                results: txResult,
            };

        } catch (err: any) {
            attempts++;

            //            if (retryCount < MAX_RETRIES && (e instanceof SendTransactionError || (e as Error).message?.includes("Blockhash not found"))) {
            //
            //                retryCount++;
            //                console.log(`Transaction failed. Retrying (${retryCount}/${MAX_RETRIES})...`);
            //
            //                // Attendre un peu avant de réessayer
            //                await new Promise(resolve => setTimeout(resolve, 500));
            //                return attemptTransaction();
            //            }

            if (isTransactionFatalError(err)) {
                if (err instanceof SendTransactionError) {
                    const logs = await (err as SendTransactionError).getLogs(connection);
                    console.error("SendTransactionError:", logs);

                    const error: SendTransactionError = new SendTransactionError({ action: 'send', signature: signature, transactionMessage: err.message, logs });

                    return {
                        error,
                        success: false,
                    };

                } else {
                    console.error("Transaction error:", err);

                    return {
                        error: err,
                        success: false,
                    };
                }
            }

            // Si on a épuisé toutes les tentatives, abandonner
            if (attempts >= MAX_RETRIES) {
                console.log(`Échec après ${MAX_RETRIES} tentatives`);
                return {
                    success: false,
                    error: err,
                };
            }
        }
    }


    // Ne devrait jamais arriver ici, mais au cas où
    throw new Error("Nombre maximum de tentatives dépassé dans sendTx");
}





export async function mockedSendSolanaTransaction(txType: 'create' | 'buy' | 'sell'): Promise<TransactionResult> {
    const results = {
        create: { success: true, signature: '5yMPE965kyiNXGb3FoDjEzxHKWBd1DmQj765hzfbZXKbsHcSn4CntEz3ZiwevMcrtDTDCsmLwxBVpRvvodAosWr' },
        buy: { success: true, signature: 'FB4yVvvX6RpNmtm6xqbN2p7UbnfYGrT7KshSEWvgsyzqmG8H4Z5dnEQCEzDtUETNWQZ8jkKVrydaFPTjr9tUB5A' },
        sell: { success: true, signature: '3JfUutfPiTjpqTF25TZWDLPy5N6DQiFqZjsEbUKnAkTbQBRnSEdHo4rD5Av1Jme9oE9cDmbLR9ELo9nw2EU69Nbr' },
    }

    if (txType === 'create') {
        return results.create;
    }

    if (txType === 'buy') {
        return results.buy;
    }

    if (txType === 'sell') {
        return results.sell;
    }

    const idx = Math.floor(Math.random() * Object.keys(results).length);
    return Object.values(results)[idx];
}



