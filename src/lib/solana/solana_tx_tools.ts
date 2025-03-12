// solana_tx_tools.ts

import { Connection } from "@solana/web3.js";


/* ######################################################### */



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

