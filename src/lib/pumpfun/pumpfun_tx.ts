// pumpfun_tx.ts

import { Commitment, ComputeBudgetProgram, Connection, Finality, Keypair, ParsedTransactionWithMeta, PublicKey, SendTransactionError, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, VersionedTransactionResponse } from "@solana/web3.js";
import { retryAsync } from "../utils/promise.util";
import { PriorityFee, TransactionResult } from "../../services/Trading.service";

/* ######################################################### */

export type TradeTransactionResult = {
    type: 'buy' | 'sell';
    tokenAmount: number;
    solAmount: number;
    mint: string;
    success: boolean;
};

/* ######################################################### */

// Tuto: https://jstarry.notion.site/Transaction-confirmation-d5b8f4e09b9c4a70a1f263f82307d7ce
export const DEFAULT_COMMITMENT: Commitment = "confirmed";
export const DEFAULT_FINALITY: Finality = "confirmed";

/* ######################################################### */



export async function sendTx(
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

    let versionedTx = await buildVersionedTx(connection, payer, newTx, commitment);
    versionedTx.sign(signers);


    // Nombre de tentatives maximum en cas d'échec
    const MAX_RETRIES = 5;
    let attempts = 0;


    while (attempts < MAX_RETRIES) {
        try {
            // Si ce n'est pas la première tentative, attendez un peu
            if (attempts > 0) {
                await new Promise(resolve => setTimeout(resolve, 200));
                console.log(`Tentative ${attempts + 1}/${MAX_RETRIES}...`);
            }


            // Obtenir un nouveau blockhash à chaque tentative
            const blockhash = await connection.getLatestBlockhash(commitment);

            let versionedTx = await buildVersionedTx(
                connection,
                payer,
                newTx,
                commitment,
                blockhash.blockhash // Passer explicitement le blockhash
            );
            versionedTx.sign(signers);

            const sig = await connection.sendTransaction(versionedTx, {
                skipPreflight: false,
                maxRetries: 3, // Autoriser des retries au niveau de l'API
                preflightCommitment: commitment
            });
            console.log("sig:", `https://solscan.io/tx/${sig}`);

            // Attendre la confirmation avec le blockhash spécifique que nous avons utilisé
            await connection.confirmTransaction({
                signature: sig,
                blockhash: blockhash.blockhash,
                lastValidBlockHeight: blockhash.lastValidBlockHeight
            }, commitment);


            let txResult = await getTxDetails(connection, sig, commitment, finality);
            if (!txResult) {
                return {
                    success: false,
                    error: "Transaction failed during confirmation",
                    signature: sig
                };
            }

            return {
                success: true,
                signature: sig,
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

            if (isFatalError(err)) {
                if (err instanceof SendTransactionError) {
                    const logs = await (err as SendTransactionError).getLogs(connection);
                    console.error("SendTransactionError:", logs);

                    return {
                        error: `${err.message}. Logs: ${logs}`,
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
    return {
        success: false,
        error: "Nombre maximum de tentatives dépassé",
    };
}

export const buildVersionedTx = async (
    connection: Connection,
    payer: PublicKey,
    tx: Transaction,
    commitment: Commitment = DEFAULT_COMMITMENT,
    explicitBlockhash?: string
): Promise<VersionedTransaction> => {
    const blockHash = explicitBlockhash ||
        (await connection.getLatestBlockhash(commitment)).blockhash;

    let messageV0 = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockHash,
        instructions: tx.instructions,
    }).compileToV0Message();

    return new VersionedTransaction(messageV0);
};


export const getTxDetails = async (
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



// Ajoutez cette méthode à votre TradingService
export async function simulateTransaction(connection: Connection, transaction: Transaction, payer: PublicKey, commitment = DEFAULT_COMMITMENT): Promise<boolean> {
    try {
        // Create a copy of the transaction for simulation
        const simulationTx = new Transaction();

        transaction.instructions.forEach(instruction => {
            simulationTx.add(instruction);
        });


        // Configure the transaction for simulation
        simulationTx.feePayer = payer;

        const { blockhash } = await connection.getLatestBlockhash(commitment);
        simulationTx.recentBlockhash = blockhash;


        // Perform the simulation
        const simulation = await connection.simulateTransaction(simulationTx);

        // Log detailed information about the simulation
        if (simulation.value.err) {
            console.error(`❌ La simulation a échoué avec l'erreur:`, simulation.value.err);

            if (simulation.value.logs) {
                console.error(`📜 Logs de simulation:`, simulation.value.logs);

                // Analyser les logs pour des indices d'erreur liés aux programmes de token
                const tokenErrors = simulation.value.logs.filter(log =>
                    log.includes("Token") && (log.includes("failed") || log.includes("Error"))
                );

                if (tokenErrors.length > 0) {
                    console.error(`🔍 Erreurs liées aux tokens:`, tokenErrors);

                    // Si l'erreur est liée au programme de token, donner des conseils spécifiques
                    if (tokenErrors.some(log => log.includes("IncorrectProgramId") || log.includes("Invalid Mint"))) {
                        console.error(`💡 Conseil: Il semble y avoir un problème avec le programme de token utilisé. Vérifiez que vous utilisez le bon programme (Token standard vs Token-2022).`);
                    }
                }
            }

            return false;
        }


        // Simulation succeeded
        return true;

    } catch (err: any) {
        console.error(`❌ Erreur de simulation:`, err);

        // Fournir plus de contexte sur l'erreur
        if (err.toString().includes("BlockhashNotFound")) {
            console.error(`💡 L'erreur BlockhashNotFound indique que le blockhash utilisé est expiré ou invalide. Essayez d'obtenir un nouveau blockhash.`);
        }

        return false;
    }
}


// Pour les transactions versionnées
export async function simulateVersionedTransaction(connection: Connection, instructions: TransactionInstruction[], payer: PublicKey, commitment = DEFAULT_COMMITMENT): Promise<boolean> {

    const blockhash = await connection.getLatestBlockhash(commitment);
    console.log('blockhash:', blockhash)

    const messageV0 = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash.blockhash,
        instructions
    }).compileToV0Message();

    const simulationTx = new VersionedTransaction(messageV0);

    const simulation = await connection.simulateTransaction(simulationTx);

    if (simulation.value.err) {
        console.error("Simulation failed with error:", simulation.value.err);
        console.error("Simulation logs:", simulation.value.logs);
        return false;
    }

    return true;
}


// Fonction pour vérifier si l'erreur est fatale
function isFatalError(error: any): boolean {
    const errorStr = String(error);

    return errorStr.includes("insufficient funds") ||
        errorStr.includes("TooMuchSolRequired");
}



/** Décode les informations d'une transaction liée à Pump.fun */
export function decodeTradeTransactionFromLogs(tx: ParsedTransactionWithMeta | null): TradeTransactionResult | null {
    if (!tx || !tx.meta) return null;

    try {
        // Vérifier si la transaction a réussi
        const success = tx.meta.err === null;

        // Chercher dans les logs pour déterminer le type et les détails
        let type: 'buy' | 'sell' | null = null;
        let mint: string | null = null;


        // Parcourir les logs pour trouver des indices
        const logs = tx.meta.logMessages || [];
        for (const log of logs) {
            if (log.includes('Instruction: Buy')) {
                type = 'buy';

            } else if (log.includes('Instruction: Sell')) {
                type = 'sell';
            }

            // Chercher des références au mint dans les logs
            const mintMatch = log.match(/mint: ([0-9a-zA-Z]{32,44})/);
            if (mintMatch && mintMatch[1]) {
                mint = mintMatch[1];
            }
        }


        // Si on n'a pas pu déterminer le type ou le mint, essayer d'autres méthodes
        if (!type || !mint) {
            // Parcourir les instructions pour trouver des informations
            if (tx.transaction && tx.transaction.message) {
                const message = tx.transaction.message;

                // Chercher les comptes qui pourraient être des mints
                const accounts = message.accountKeys;
                for (const account of accounts) {
                    // Les mints Pump.fun se terminent souvent par "pump"
                    if (account.pubkey && account.pubkey.toString().endsWith('pump')) {
                        mint = account.pubkey.toString();
                        break;
                    }
                }
            }
        }


        // Si on n'a toujours pas les informations nécessaires, analyser les changements de balances
        let tokenAmount = 0;
        let solAmount = 0;


        // Calculer les changements de balances de tokens
        if (tx.meta.postTokenBalances && tx.meta.preTokenBalances) {
            const preBalances = new Map();
            tx.meta.preTokenBalances.forEach(balance => {
                preBalances.set(`${balance.owner}-${balance.mint}`, balance.uiTokenAmount.uiAmount || 0);
            });

            tx.meta.postTokenBalances.forEach(balance => {
                const key = `${balance.owner}-${balance.mint}`;
                const pre = preBalances.get(key) || 0;
                const post = balance.uiTokenAmount.uiAmount || 0;
                const diff = post - pre; // TODO?: diviser par 1e6 ?

                if (Math.abs(diff) > 0) {
                    tokenAmount = Math.abs(diff);
                    mint = balance.mint;
                    type = diff > 0 ? 'buy' : 'sell';
                }
            });
        }


        // Calculer le changement de SOL
        if (tx.meta.preBalances && tx.meta.postBalances) {
            for (let i = 0; i < tx.meta.preBalances.length; i++) {
                const pre = tx.meta.preBalances[i];
                const post = tx.meta.postBalances[i];
                const diff = (post - pre) / 1e9; // Convertir lamports en SOL

                if (Math.abs(diff) > 0.001) { // Ignorer les petits changements (frais)
                    solAmount = Math.abs(diff);
                    // Si on n'a pas encore déterminé le type, le faire en fonction du changement de SOL
                    if (!type) {
                        type = diff < 0 ? 'buy' : 'sell';
                    }
                }
            }
        }


        // Si on n'a pas pu déterminer toutes les informations nécessaires
        if (!type || !mint) {
            console.warn("Impossible de décoder complètement la transaction");
            return null;
        }

        return {
            type,
            tokenAmount,
            solAmount,
            mint,
            success
        };

    } catch (err: any) {
        console.error("Erreur lors du décodage de la transaction:", err);
        return null;
    }
}




export const getParsedTransactionWithRetries = async (connection: Connection, signature: string, onRetry?: (attempt: number, elapsedMs: number) => void) => {
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


