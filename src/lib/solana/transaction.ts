import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { TransactionResult } from "../../services/Trading.service";


/* ######################################################### */


export async function sendSolanaTransaction(connection: Connection, wallet: Keypair, tx: VersionedTransaction, options?: { skipPreflight: false }) {
    let success = false;
    let error = undefined;

    tx.sign([wallet]);

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



// Exemple simple de priorityFee dynamique
export async function getDynamicPriorityFee(connection: Connection) {
    try {
        // Récupérer les frais récents pour mesurer la congestion
        const recentPerformanceSamples = await connection.getRecentPerformanceSamples(5);
        const avgTps = recentPerformanceSamples.reduce((sum, sample) => sum + sample.numTransactions / sample.samplePeriodSecs, 0) / recentPerformanceSamples.length;

        // Si TPS élevé = réseau congestionné = frais plus élevés
        if (avgTps > 6000) return 0.00100; // Très Très Très congestionné
        if (avgTps > 5000) return 0.00050; // Très Très congestionné
        if (avgTps > 4000) return 0.00020; // Très congestionné
        if (avgTps > 3000) return 0.00010; // Congestionné
        if (avgTps > 1000) return 0.00005; // Moyennement congestionné

        return 0.00001; // Peu congestionné

    } catch (err: any) {
        // Par défaut, retourner une valeur élevée en cas d'erreur
        return 0.001;
    }
}

