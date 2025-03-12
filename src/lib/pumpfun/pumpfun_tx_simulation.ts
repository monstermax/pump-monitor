// pumpfun_tx.ts

import { Connection, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { DEFAULT_COMMITMENT } from "./pumpfun_config";

/* ######################################################### */


// Simule une transaction legacy (non-versionnée)
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


// Simule un transaction versionnées
export async function simulateVersionedTransaction(connection: Connection, instructions: TransactionInstruction[], payer: PublicKey, commitment = DEFAULT_COMMITMENT): Promise<boolean> {

    const blockhash = await connection.getLatestBlockhash(commitment);
    //console.log('blockhash:', blockhash)

    const messageV0 = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash.blockhash,
        instructions
    }).compileToV0Message();

    const simulationTx = new VersionedTransaction(messageV0);

    const simulation = await connection.simulateTransaction(simulationTx);

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

    return true;
}




