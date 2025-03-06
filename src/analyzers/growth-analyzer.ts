// growth-analyzer.ts

import { appConfig } from '../env';
import { Token, Trade } from '../models/Token.model';



/** Analyse de la croissance du token au fil du temps */
export interface GrowthAnalysis {
    metrics: {
        velocities: Record<string, number>; // "10k", "30k", etc. -> $/seconde
        volatility: number;          // 0-100, mesure de régularité
    };
    healthScore: number;           // 0-100
}



/**
 * Analyseur spécialisé dans l'évaluation de la croissance et des jalons des tokens.
 */
export class GrowthAnalyzer {

    /** Met à jour l'analyse de croissance d'un token après un trade */
    public updateGrowthAnalysis(
        existingGrowthAnalysis: GrowthAnalysis,
        token: Token,
        trade: Trade
    ): GrowthAnalysis {
        // Cloner l'analyse existante pour éviter de modifier l'original
        const updatedAnalysis: GrowthAnalysis = {
            metrics: {
                velocities: { ...existingGrowthAnalysis.metrics.velocities },
                volatility: existingGrowthAnalysis.metrics.volatility
            },
            healthScore: existingGrowthAnalysis.healthScore
        };

        // Calculer le score de santé en fonction des métriques
        updatedAnalysis.healthScore = this.calculateHealthScore(updatedAnalysis);

        return updatedAnalysis;
    }


    /** Calcule le score de santé de la croissance */
    private calculateHealthScore(analysis: GrowthAnalysis): number {
        // Si pas assez de données, retourner un score neutre
        let score = 100;

        // Pénalité pour une grande volatilité (croissance irrégulière)
        if (analysis.metrics.volatility > 50) {
            score -= (analysis.metrics.volatility - 50) * 0.6;
        }

        // Pénalité pour une grande différence de vitesse entre phases
        const velocities = Object.values(analysis.metrics.velocities);
        if (velocities.length >= 2) {
            const maxVelocity = Math.max(...velocities);
            const minVelocity = Math.min(...velocities);

            if (minVelocity > 0) {
                const velocityRatio = maxVelocity / minVelocity;

                if (velocityRatio > 10) { // Ratio > 10x entre les vitesses
                    score -= 25;
                } else if (velocityRatio > 5) {
                    score -= 15;
                }
            }
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    }


    /** Initialise une analyse de croissance vide */
    public initializeGrowthAnalysis(): GrowthAnalysis {
        return {
            metrics: {
                velocities: {},
                volatility: 0
            },
            healthScore: 50 // Score neutre par défaut
        };
    }
}
