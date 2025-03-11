// TokenAnalysis.model.ts

import { GrowthAnalysis } from "../analyzers/growth-analyzer";
import { OpportunityAnalysis } from "../analyzers/opportunity-analyzer";
import { RiskAnalysis } from "../analyzers/risk-analyzer";
import { SafetyAnalysis } from "../analyzers/safety-analyzer";
import { TradingAnalysis } from "../analyzers/trading-signal-analyzer";
import { TokenTrend } from "./Token.model";



export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type TradingAction = 'BUY' | 'SELL' | 'HOLD' | 'AVOID';


export interface TokenAnalysis {
    tokenAddress: string;
    lastUpdated: Date;

    initialOpportunity: OpportunityAnalysis;
    growth: GrowthAnalysis;
    risk: RiskAnalysis;
    safety: SafetyAnalysis;
    tradingSignal: TradingAnalysis;

    trends: {
        ultraShort?: TokenTrend;  // Tendance très courte (ex: 10 secondes)
        veryShort?: TokenTrend;   // Tendance courte (ex: 30 secondes)
        short?: TokenTrend;       // Tendance moyenne (ex: 2 minutes)
        medium?: TokenTrend;      // Tendance longue (ex: 5 minutes)
    };
}




/** Résumé de l'analyse d'un token */
export interface AnalysisSummary {
    safety: {
        score: number;             // Score de sécurité (0-100)
        indicatorsCount: number;   // Nombre d'indicateurs positifs
        topIndicator: string;      // Principal indicateur positif
    };
    risk: {
        score: number;             // Score de risque (0-100)
        redFlagsCount: number;     // Nombre de drapeaux rouges
        rugPullProbability: number; // Probabilité de rug pull
        topRiskFactor: string;     // Principal facteur de risque
    };
    growth: {
        healthScore: number;       // Score de santé de croissance
        milestoneCount: number;    // Nombre de jalons atteints
        volatility: number;        // Volatilité de la croissance
    };
    trading: {
        recommendation: string;    // BUY, SELL, HOLD, AVOID
        confidence: number;        // Niveau de confiance
        stopLoss?: number;         // Prix de stop loss recommandé
    };
    trends: {
        shortTermChange: number;   // % de changement à court terme
        buyPressure: number;       // -100 à +100 (pression d'achat/vente)
        volumeRatio: number;       // Ratio d'achats/ventes
    };
    updated: Date;                 // Date de dernière mise à jour
}

