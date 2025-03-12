// solana_tx_tools.ts

import { Connection } from "@solana/web3.js";
import { PriorityFee } from "./solana_tx_sender";


/* ######################################################### */



export async function getDynamicPriorityFee(connection: Connection, type: 'standard' | 'jito' = 'standard'): Promise<number> {
    try {
        // Récupérer les données de performance récentes pour mesurer la congestion
        const recentPerformanceSamples = await connection.getRecentPerformanceSamples(10);
        const avgTps = recentPerformanceSamples.reduce((sum, sample) => sum + sample.numTransactions / sample.samplePeriodSecs, 0) / recentPerformanceSamples.length;

        // Vérifier également les prix récents des micro-lamports
        const priorityFeeData = await connection.getRecentPrioritizationFees();
        const recentMedianFee = priorityFeeData.length > 0
            ? Math.max(...priorityFeeData.map(data => data.prioritizationFee)) / 1_000_000
            : 0;

        // Calculer la congestion basée sur TPS et prix récent des fees
        const tpsBasedFee = (() => {
            // Valeurs standards pour transactions normales
            if (type === 'standard') {
                if (avgTps > 5000) return 0.000200; // Extrêmement congestionné
                if (avgTps > 4500) return 0.000100; // Très congestionné
                if (avgTps > 4000) return 0.000050; // Congestionné
                if (avgTps > 3000) return 0.000025; // Moyennement congestionné
                return 0.000010;                    // Peu congestionné

            } else {
                // Valeurs pour les bundles Jito (plus élevées)
                if (avgTps > 5000) return 0.003000; // Extrêmement congestionné
                if (avgTps > 4500) return 0.002000; // Très congestionné
                if (avgTps > 4000) return 0.001000; // Congestionné
                if (avgTps > 3000) return 0.000500; // Moyennement congestionné
                return 0.000100;                    // Peu congestionné
            }
        })();

        // Prendre le maximum entre notre calcul basé sur TPS et le prix observé récemment sur le réseau
        // Cela nous protège contre les hausses soudaines que notre mesure TPS pourrait manquer
        const finalFee = Math.max(tpsBasedFee, recentMedianFee * 1.2); // 20% au-dessus de la médiane récente

        return type === 'standard' ? Math.min(finalFee, 0.001) : Math.min(finalFee, 0.005);

    } catch (err: any) {
        console.warn("Erreur lors du calcul des frais dynamiques:", err.message);
        // Valeur par défaut conservatrice en cas d'erreur
        return type === 'standard' ? 0.0001 : 0.001;
    }
}



export function getDynamicComputeUnitPrice(avgTps: number, type: 'standard' | 'jito' = 'standard'): PriorityFee {
    // Pour transactions standard
    if (type === 'standard') {
        if (avgTps > 5000) return { unitPrice: 1000, unitLimit: 1_000_000 };    // Très congestionné
        if (avgTps > 4500) return { unitPrice: 500, unitLimit: 1_000_000 };     // Congestionné
        if (avgTps > 4000) return { unitPrice: 250, unitLimit: 1_000_000 };     // Moyennement congestionné
        if (avgTps > 3000) return { unitPrice: 100, unitLimit: 1_000_000 };     // Peu congestionné
        return { unitPrice: 50, unitLimit: 1_000_000 };                         // Très peu congestionné

    } else {
        // Pour bundles Jito
        if (avgTps > 5000) return { unitPrice: 10000, unitLimit: 1_400_000 };   // Très congestionné
        if (avgTps > 4500) return { unitPrice: 5000, unitLimit: 1_400_000 };    // Congestionné
        if (avgTps > 4000) return { unitPrice: 2500, unitLimit: 1_400_000 };    // Moyennement congestionné
        if (avgTps > 3000) return { unitPrice: 1000, unitLimit: 1_400_000 };    // Peu congestionné
        return { unitPrice: 500, unitLimit: 1_400_000 };                        // Très peu congestionné
    }
}

