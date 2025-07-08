// trading-signal-analyzer.ts

import { Token } from "../models/Token.model";
import { TradingAction } from "../models/TokenAnalysis.model";
import { GrowthAnalysis } from "./growth-analyzer";
import { RiskAnalysis } from "./risk-analyzer";
import { SafetyAnalysis } from "./safety-analyzer";



/**
 * Signal de trading (recommandation d'achat/vente)
 */
export interface TradingAnalysis {
    action: TradingAction;
    confidence: number;            // 0-100
    reasons: string[];
    stopLoss?: string;             // Prix suggéré pour stop loss
    takeProfit?: string;           // Prix suggéré pour take profit
    entryPoints?: string[];        // Prix d'entrée suggérés pour BUY
}



/**
 * Analyseur spécialisé dans la génération de signaux de trading
 * basés sur la combinaison des différentes analyses de token
 */
export class TradingSignalAnalyzer {

    /** Génère un signal de trading basé sur les analyses disponibles */
    public generateTradingSignal(
        token: Token,
        growthAnalysis: GrowthAnalysis,
        riskAnalysis: RiskAnalysis,
        safetyAnalysis: SafetyAnalysis,
        trends: Record<string, any> = {},
        currentPrice: string
    ): TradingAnalysis {

        // Récupérer les scores de chaque analyse
        const growthHealthScore = growthAnalysis.healthScore;
        const riskScore = riskAnalysis.score;
        const safetyScore = safetyAnalysis.score;

        // Récupérer les tendances récentes
        const ultraShortTrend = trends.ULTRA_SHORT;
        const veryShortTrend = trends.VERY_SHORT;

        // Déterminer l'action à recommander
        const { action, confidence, reasons } = this.determineAction(
            growthHealthScore,
            riskScore,
            safetyScore,
            ultraShortTrend,
            veryShortTrend,
            riskAnalysis.redFlags,
            safetyAnalysis.indicators
        );

        // Préparer le signal de trading
        const tradingSignal: TradingAnalysis = {
            action,
            confidence,
            reasons
        };

        // Ajouter des informations supplémentaires selon l'action
        if (action === 'BUY') {
            tradingSignal.stopLoss = this.calculateStopLoss(currentPrice, riskScore);
            tradingSignal.takeProfit = this.calculateTakeProfit(currentPrice, growthHealthScore);
            tradingSignal.entryPoints = this.calculateEntryPoints(currentPrice, growthHealthScore, safetyScore);

        } else if (action === 'SELL') {
            // Pour une action SELL, on peut suggérer des niveaux de sortie
            if (ultraShortTrend && veryShortTrend) {
                const pumpDetected = this.isPumpDetected(ultraShortTrend, veryShortTrend);
                if (pumpDetected) {
                    tradingSignal.reasons.push('Pump détecté, vente recommandée avant correction');
                }
            }
        }

        // Affichage optionnel du signal
        if (0) {
            this.displayTradingSignal(tradingSignal, token);
        }

        return tradingSignal;
    }

    /**
     * Détermine l'action à recommander basée sur les analyses
     */
    private determineAction(
        growthHealthScore: number,
        riskScore: number,
        safetyScore: number,
        ultraShortTrend: any,
        veryShortTrend: any,
        redFlags: any[],
        safetyIndicators: any[]
    ): { action: 'BUY' | 'SELL' | 'HOLD' | 'AVOID'; confidence: number; reasons: string[] } {
        const reasons: string[] = [];

        // Cas de vente critique : risque très élevé
        if (riskScore >= 70) {
            const confidence = Math.min(100, riskScore);

            // Ajouter quelques raisons spécifiques pour la vente
            reasons.push(`Risque élevé détecté (${riskScore}/100)`);

            // Ajouter les red flags critiques aux raisons
            const criticalFlags = redFlags
                .filter(flag => flag.severity === 'HIGH')
                .slice(0, 3); // Limiter à 3 flags maximum

            criticalFlags.forEach(flag => {
                reasons.push(flag.description);
            });

            return { action: 'SELL', confidence, reasons };
        }

        // Cas d'achat favorable : bonne sécurité et faible risque
        if (safetyScore >= 70 && riskScore <= 30 && growthHealthScore >= 60) {
            const confidence = Math.min(100, safetyScore - riskScore + 10);

            reasons.push(`Token sécurisé avec bon potentiel (Sécurité: ${safetyScore}/100, Risque: ${riskScore}/100)`);

            // Ajouter quelques indicateurs de sécurité aux raisons
            const topIndicators = safetyIndicators
                .filter(indicator => indicator.strength === 'HIGH')
                .slice(0, 2); // Limiter à 2 indicateurs maximum

            topIndicators.forEach(indicator => {
                reasons.push(indicator.description);
            });

            return { action: 'BUY', confidence, reasons };
        }

        // Cas de hold : risque modéré mais facteurs positifs
        if (safetyScore > riskScore && growthHealthScore >= 50) {
            const confidence = Math.min(100, 50 + (safetyScore - riskScore) / 2);

            reasons.push(`Balance globale positive (Sécurité: ${safetyScore}/100, Risque: ${riskScore}/100)`);

            if (veryShortTrend && veryShortTrend.marketCap.change > 0) {
                reasons.push(`Tendance récente positive: +${veryShortTrend.marketCap.change.toFixed(1)}%`);
            }

            return { action: 'HOLD', confidence, reasons };
        }

        // Cas d'évitement : risque supérieur à la sécurité
        const confidence = Math.min(100, 50 + (riskScore - safetyScore) / 2);

        reasons.push(`Risque supérieur aux indicateurs positifs (Risque: ${riskScore}/100, Sécurité: ${safetyScore}/100)`);

        // Ajouter quelques red flags aux raisons
        const mostImportantFlags = redFlags
            .slice(0, 2); // Limiter à 2 flags maximum

        mostImportantFlags.forEach(flag => {
            reasons.push(flag.description);
        });

        return { action: 'AVOID', confidence, reasons };
    }


    /** Calcule le stop loss recommandé */
    private calculateStopLoss(currentPrice: string, riskScore: number): string {
        // Plus le risque est élevé, plus le stop loss est serré
        let stopLossPercentage: number;

        if (riskScore >= 50) {
            stopLossPercentage = 0.85; // -15% pour risque moyen/élevé
        } else if (riskScore >= 30) {
            stopLossPercentage = 0.80; // -20% pour risque faible/moyen
        } else {
            stopLossPercentage = 0.75; // -25% pour risque très faible
        }

        return (Number(currentPrice) * stopLossPercentage).toFixed(10);
    }


    /** Calcule le take profit recommandé */
    private calculateTakeProfit(currentPrice: string, growthHealthScore: number): string {
        // Plus la croissance est saine, plus l'objectif est ambitieux
        let takeProfitPercentage: number;

        if (growthHealthScore >= 80) {
            takeProfitPercentage = 2.0; // +100% pour croissance très saine
        } else if (growthHealthScore >= 60) {
            takeProfitPercentage = 1.7; // +70% pour croissance saine
        } else {
            takeProfitPercentage = 1.5; // +50% pour croissance moyenne
        }

        return (Number(currentPrice) * takeProfitPercentage).toFixed(10);
    }


    /** Calcule les points d'entrée recommandés */
    private calculateEntryPoints(
        currentPrice: string,
        growthHealthScore: number,
        safetyScore: number
    ): string[] {
        // Point d'entrée immédiat
        const entryPoints = [currentPrice];

        // Points d'entrée sur correction
        const correctionFactor1 = this.getCorrectionFactor(growthHealthScore, safetyScore, 1);
        const correctionFactor2 = this.getCorrectionFactor(growthHealthScore, safetyScore, 2);

        entryPoints.push((Number(currentPrice) * (1 - correctionFactor1)).toFixed(10));
        entryPoints.push((Number(currentPrice) * (1 - correctionFactor2)).toFixed(10));

        return entryPoints;
    }


    /** Calcule le facteur de correction pour les points d'entrée */
    private getCorrectionFactor(
        growthHealthScore: number,
        safetyScore: number,
        level: number
    ): number {
        // Base de correction selon le niveau
        const baseCorrection = level === 1 ? 0.05 : 0.10;

        // Ajustement selon les scores
        const scoreAdjustment = (100 - ((growthHealthScore + safetyScore) / 2)) / 100;

        // Plus les scores sont bas, plus on attend une correction importante
        return baseCorrection + (baseCorrection * scoreAdjustment);
    }


    /** Détecte si un pump est en cours */
    private isPumpDetected(ultraShortTrend: any, veryShortTrend: any): boolean {
        if (!ultraShortTrend || !veryShortTrend) return false;

        // Calculer les pressions de volume pour chaque fenêtre
        const calculatePressure = (trend: any): number => {
            const netVolume = trend.trades.buyVolume - trend.trades.sellVolume;
            const totalVolume = trend.trades.buyVolume + trend.trades.sellVolume;
            return totalVolume > 0 ? (netVolume / totalVolume) * 100 : 0;
        };

        const ultraShortPressure = calculatePressure(ultraShortTrend);
        const veryShortPressure = calculatePressure(veryShortTrend);

        // Détection de pump (achat massif et rapide)
        return ultraShortPressure > 75 && veryShortPressure > 60;
    }


    /** Affiche le signal de trading sur la console */
    private displayTradingSignal(tradingSignal: TradingAnalysis, token: Token): void {
        const actionEmojis = {
            'BUY': '🟢',
            'SELL': '🔴',
            'HOLD': '🟡',
            'AVOID': '⚫'
        };

        console.log(`\n📊 SIGNAL DE TRADING pour ${token.symbol} (${token.address})`);
        console.log(`   ${actionEmojis[tradingSignal.action]} ${tradingSignal.action} (${tradingSignal.confidence}% de confiance)`);

        console.log('   Raisons:');
        tradingSignal.reasons.forEach(reason => {
            console.log(`   • ${reason}`);
        });

        if (tradingSignal.stopLoss) {
            console.log(`   Stop Loss: ${tradingSignal.stopLoss} SOL`);
        }

        if (tradingSignal.takeProfit) {
            console.log(`   Take Profit: ${tradingSignal.takeProfit} SOL`);
        }

        if (tradingSignal.entryPoints && tradingSignal.entryPoints.length > 0) {
            console.log('   Points d\'entrée:');
            tradingSignal.entryPoints.forEach((price, i) => {
                console.log(`   ${i + 1}. ${price} SOL`);
            });
        }
    }
}

