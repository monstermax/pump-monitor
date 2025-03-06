// TokenAnalyzer.service.ts

import { ServiceAbstract } from "./abstract.service";
import { ServiceManager } from "../managers/Service.manager";
import { Token, Trade } from "../models/Token.model";
import { TokenAnalysis } from "../models/TokenAnalysis.model";
import { OpportunityAnalysis, OpportunityAnalyzer } from "../analyzers/opportunity-analyzer";
import { GrowthAnalysis, GrowthAnalyzer } from "../analyzers/growth-analyzer";
import { RiskAnalyzer } from "../analyzers/risk-analyzer";
import { SafetyAnalyzer } from "../analyzers/safety-analyzer";
import { TrendAnalyzer } from "../analyzers/trend-analyzer";
import { TradingAnalysis, TradingSignalAnalyzer } from "../analyzers/trading-signal-analyzer";


/* ######################################################### */


export class TokenAnalyzer extends ServiceAbstract {
    private opportunityAnalyzer: OpportunityAnalyzer
    private growthAnalyzer: GrowthAnalyzer;
    private riskAnalyzer: RiskAnalyzer;
    private safetyAnalyzer: SafetyAnalyzer;
    private trendAnalyzer: TrendAnalyzer;
    private tradingSignalAnalyzer: TradingSignalAnalyzer;


    constructor(serviceManager: ServiceManager) {
        super(serviceManager);

        this.opportunityAnalyzer = new OpportunityAnalyzer;
        this.growthAnalyzer = new GrowthAnalyzer;
        this.riskAnalyzer = new RiskAnalyzer;
        this.safetyAnalyzer = new SafetyAnalyzer;
        this.trendAnalyzer = new TrendAnalyzer;
        this.tradingSignalAnalyzer = new TradingSignalAnalyzer;
    }


    start() {
        if (this.status !== 'stopped') return;
        super.start();

        this.tokenManager.on('new_token_added', this.handleNewToken.bind(this));
        this.tokenManager.on('new_trade_added', this.handleNewTrade.bind(this));

        super.started();
    }


    stop() {
        if (this.status !== 'started') return;
        super.stop();

        this.tokenManager.off('new_token_added', this.handleNewToken.bind(this));
        this.tokenManager.off('new_trade_added', this.handleNewTrade.bind(this));

        super.stopped();
    }


    /** Déclenche la création de l'analyse d'un token après le mint */
    private async handleNewToken(token: Token) {
        //console.log('DEBUG TokenTokenAnalyzerManager: handleNewToken', token);
        this.log(`Analyse token ${token.address} après mint`);

        // Création de l'analyse
        const analysis = this.createTokenAnalysisAfterMint(token);

        // Enregistrement de l'analyse
        this.db.addTokenAnalysis(analysis);
        this.emit('token_analysis_added', analysis);
    }


    /** Déclenche la mise à jour de l'analyse d'un token après un trade (buy/sell) */
    private async handleNewTrade(trade: Trade) {
        //console.log('DEBUG TokenAnalyzer: handleTrade', trade);
        this.log(`Analyse token ${trade.tokenAddress} après ${trade.type} ${trade.solAmount.toFixed(3)} SOL`);

        // Chargement du token
        const token = this.db.getTokenByAddress(trade.tokenAddress);

        if (! token) {
            this.warn(`Token ${trade.tokenAddress} non trouvé pour ${trade.type} ${trade.solAmount.toFixed(3)} SOL par ${trade.traderAddress}`);
            return;
        }


        // Mise à jour de l'analyse avec les données du trade
        this.updateTokenAnalysisAfterTrade(token, trade);

    }


    /** Création de l'analyse d'un token après le mint */
    private createTokenAnalysisAfterMint(token: Token): TokenAnalysis {

        // Analyse d'opportunité initiale (pour décider d'un achat immédiat)
        const opportunity = this.opportunityAnalyzer.analyzeInitialOpportunity(token);


        const tokenAnalysis: TokenAnalysis = {
            tokenAddress: token.address,
            lastUpdated: new Date(),

            // Initialiser l'opportunité d'achat
            initialOpportunity: opportunity,

            // Initialiser la section de croissance avec des valeurs vides
            growth: {
                metrics: {
                    velocities: {},
                    volatility: 0
                },
                healthScore: 50 // Score neutre par défaut
            },

            // Initialiser la section de risque avec des valeurs vides
            risk: {
                score: 50, // Score neutre par défaut
                redFlags: [],
                rugPullProbability: 0
            },

            // Initialiser la section de sécurité avec des valeurs vides
            safety: {
                score: 50, // Score neutre par défaut
                indicators: []
            },

            // Initialiser le signal de trading à partir de l'opportunité
            tradingSignal: this.generateInitialTradingSignal(opportunity, token.price),

            // Initialiser les tendances avec un objet vide
            trends: {},
        };

        return tokenAnalysis;
    }


    /**
     * Convertit une opportunité d'achat initiale en signal de trading
     * @param opportunity L'analyse d'opportunité
     * @param price Le prix actuel du token
     * @returns Un signal de trading initial
     */
    private generateInitialTradingSignal(opportunity: OpportunityAnalysis, currentPrice: string): TradingAnalysis {
        const price = Number(currentPrice);

        // Si le score d'opportunité est suffisamment élevé, recommander l'achat
        if (opportunity.score >= 70) {
            return {
                action: "BUY",
                confidence: opportunity.confidence,
                reasons: ["Nouvelle opportunité détectée avec score élevé", ...opportunity.reasons],
                stopLoss: (price * 0.7).toFixed(10), // Stop loss à -30%
                takeProfit: (price * 1.5).toFixed(10), // Take profit à +50%
                entryPoints: [price.toFixed(10), (price * 0.95).toFixed(10), (price * 0.9).toFixed(10)] // Points d'entrée
            };

        } else if (opportunity.score >= 50) {
            return {
                action: "HOLD",
                confidence: opportunity.confidence,
                reasons: ["Opportunité potentielle, surveillance recommandée", ...opportunity.reasons]
            };

        } else {
            return {
                action: "AVOID",
                confidence: 100 - opportunity.confidence,
                reasons: ["Score d'opportunité trop faible", ...opportunity.reasons]
            };
        }
    }



    /** Mise à jour de l'analyse d'un token après un trade (buy/sell) */
    private updateTokenAnalysisAfterTrade(token: Token, trade: Trade): void {

        // Chargement de l'analyse
        const analysis: TokenAnalysis | null = this.db.getTokenAnalysis(trade.tokenAddress);

        if (! analysis) {
            this.warn(`Analyse du Token ${trade.tokenAddress} non trouvée pour ${trade.type} ${trade.solAmount.toFixed(3)} SOL par ${trade.traderAddress}`);
            return;
        }


        // Mettre à jour les différentes composantes d'analyse
        const growthUpdate: GrowthAnalysis = this.growthAnalyzer.updateGrowthAnalysis(
            analysis.growth,
            token,
            trade
        );

        // Récupérer tous les trades récents pour ce token pour l'analyse de risque
        const recentTrades = token.trades.slice(-1000);

        const riskUpdate = this.riskAnalyzer.updateRiskAnalysis(
            analysis.risk,
            token,
            trade,
            recentTrades
        );

        const safetyUpdate = this.safetyAnalyzer.updateSafetyAnalysis(
            analysis.safety,
            token,
            trade,
            recentTrades
        );

        // Mettre à jour les tendances pour les différentes fenêtres temporelles
        const trendsUpdate = this.trendAnalyzer.updateTrends(
            token,
            analysis.trends || {},
            trade
        );

        // Générer un signal de trading basé sur toutes les analyses mises à jour
        const tradingSignal = this.tradingSignalAnalyzer.generateTradingSignal(
            token,
            growthUpdate,
            riskUpdate,
            safetyUpdate,
            trendsUpdate,
            trade.price
        );


        // Assembler l'analyse mise à jour
        const updatedAnalysis: TokenAnalysis = {
            ...analysis,
            lastUpdated: new Date(),
            growth: growthUpdate,
            risk: riskUpdate,
            safety: safetyUpdate,
            tradingSignal: tradingSignal,
            trends: trendsUpdate,
        };


        // Enregistrement de l'analyse
        if (this.db.updateTokenAnalysis(trade.tokenAddress, updatedAnalysis)) {
            this.emit('token_analysis_updated', analysis);
        }
    }


}


