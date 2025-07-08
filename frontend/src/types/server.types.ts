
// token.repository.type.ts



/** Détails d'un Token */
export interface Token {
    address: string;
    creator: string;
    name: string;
    symbol: string;
    uri: string;
    image: string;
    website: string;
    twitter: string;
    telegram: string;
    createdAt: Date;
    lastUpdated: Date;
    price: string; // SOL
    totalSupply: number;
    marketCapSOL: number;
    marketCapUSD: number;
    holders: TokenHolder[];
    analyticsSummary: AnalysisSummary | null;

    trades: Trade[];

    boundingCurve: {
        address: string,
        tokenAmount: number,
        solAmount: number,
        percentage: number, // pourcentage des tokens qui sont (encore) dans la bonding curve
    }

    trends: {
        ultraShort?: TokenTrend;  // Tendance très courte (ex: 10 secondes)
        veryShort?: TokenTrend;   // Tendance courte (ex: 30 secondes)
        short?: TokenTrend;       // Tendance moyenne (ex: 2 minutes)
        medium?: TokenTrend;      // Tendance longue (ex: 5 minutes)
    };

    milestones: TokenMilestone[];

    kpis: TokenKpi;
}



export interface TokenKpi {
    priceMin: string;
    priceMax: string;
    marketCapUSDMin: number;
    marketCapUSDMax: number;
    holdersMin: number;
    holdersMax: number;
    devBalanceMin: number | null;
    devBalanceMax: number | null;
};


/** Détails d'un Holder de Token */
export interface TokenHolder {
    address: string;
    tokenBalance: number;
    percentage: number;
    type: 'dev' | 'bondingCurve' | 'trader';
    tradesCount: number;
    firstBuy: Date;
    lastUpdate: Date;
    tokenBlanceMax: number;
}



export interface Trade {
    timestamp: Date;
    type: 'create' | 'buy' | 'sell';
    tokenAddress: string;
    traderAddress: string;
    solAmount: number;
    tokenAmount: number;
    price: string;
    marketCapSOL: number;
    marketCapUSD: number;
}




// token-analysis-service.ts

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




/** Analyse de tendance sur une fenêtre temporelle */
export interface TokenTrend {
    tokenAddress: string;
    windowType: 'ULTRA_SHORT' | 'VERY_SHORT' | 'SHORT' | 'MEDIUM';
    window: {
        start: Date;
        end: Date;
    };
    trades: {
        buyCount: number;
        sellCount: number;
        buyVolume: number;     // en SOL
        sellVolume: number;    // en SOL
    };
    marketCap: {
        start: number;         // en USD
        end: number;           // en USD
        change: number;        // en %
    };
    kpis: TokenKpi;
}


/** Milestone atteint par un token */
export interface TokenMilestone {
    marketCapUSD: number;
    timeToReach: number;        // secondes depuis le mint
    reachedAt: Date;
}




// opportunity-analyzer.ts

/**
 * Analyse d'opportunité initiale lors de la création d'un token
 * Utilisé pour décider si on achète immédiatement après le mint
 */
export interface OpportunityAnalysis {
    score: number;                // 0-100
    recommendedAmount: number;    // en SOL
    confidence: number;           // 0-100
    reasons: string[];            // Raisons de l'opportunité
    metrics: {
        nameScore: number;          // Score du nom (0-100)
        symbolScore: number;        // Score du symbole (0-100)
        socialScore: number;        // Présence sociale (0-100)
        initialVolumeScore: number; // Volume initial (0-100)
        growthPotentialScore: number; // Potentiel de croissance (0-100)
        holdersScore: number;       // Distribution des holders (0-100)
        creatorScore: number;       // Historique du créateur (0-100)
    }
}



// growth-analyzer.ts

/**
 * Analyse de la croissance du token au fil du temps
 */
export interface GrowthAnalysis {
    milestones: TokenMilestone[];
    metrics: {
        velocities: Record<string, number>; // "10k", "30k", etc. -> $/seconde
        volatility: number;          // 0-100, mesure de régularité
    };
    healthScore: number;           // 0-100
}




// rug-pull-analyzer.ts

/**
 * Analyse de risque (détection de rug pull)
 */
export interface RiskAnalysis {
    score: number;                 // 0-100
    redFlags: RiskFlag[];
    rugPullProbability: number;    // 0-100
}


/**
 * Indicateur de risque détecté
 */
export interface RiskFlag {
    type: string;                // "GROWTH_SPEED", "SELLING_PRESSURE", etc.
    severity: Severity;
    description: string;
    detectedAt: Date;
}



// safety-analyzer.ts


/**
 * Analyse de sécurité et de qualité
 */
export interface SafetyAnalysis {
    score: number;                 // 0-100
    indicators: SafetyIndicator[];
}

/**
 * Indicateur de sécurité/qualité
 */
export interface SafetyIndicator {
    type: string;                // "HOLDER_DISTRIBUTION", "TRADING_PATTERN", etc.
    strength: Severity;
    description: string;
    detectedAt: Date;
}




// socket-io-server.type.ts


export type TradingRecommendation = {
    action: "BUY" | "SELL" | "HOLD" | "AVOID";
    confidence: number;
    reasons: string[];
    stopLoss?: number;
    entryPoints?: number[];
};





// rug-pull-analyzer.type.ts


export interface RedFlag {
    type: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    description: string;
};



export interface RugPullAnalysis {
    redFlags: RedFlag[];
    riskScore: number;  // 0-100
}




// trading-signal-analyzer.ts


/**
 * Signal de trading (recommandation d'achat/vente)
 */
export interface TradingAnalysis {
    action: TradingAction;
    confidence: number;            // 0-100
    reasons: string[];
    stopLoss?: number;             // Prix suggéré pour stop loss
    takeProfit?: number;           // Prix suggéré pour take profit
    entryPoints?: number[];        // Prix d'entrée suggérés pour BUY
}





// portfolio.model.ts


export type Portfolio = {
    walletAddress: string;
    balanceSOL: number;
    holdings: PortfolioHolding[],
    stats: PortfolioStats,
    settings: PortfolioSettings,
    autoTrading: boolean,
};

// Types pour le portfolio
export interface PortfolioHolding {
    tokenAddress: string;
    tokenSymbol: string;
    tokenName: string;
    amount: number;         // Quantité de tokens
    avgBuyPrice: string;    // Prix moyen d'achat (SOL)
    totalInvestment: number; // Montant total investi (SOL)
    currentPrice: string;   // Prix actuel (SOL)
    currentValue: number;   // Valeur actuelle (SOL)
    profitLoss: number;     // Profit/Perte (SOL)
    profitLossPercent: number; // Profit/Perte (%)
    lastUpdated: Date;      // Dernière mise à jour
    transactions: PortfolioTransaction[]; // Transactions associées à ce holding
    closed: boolean;
}


export interface PortfolioTransaction {
    timestamp: Date;
    type: 'buy' | 'sell';
    tokenAmount: number;
    solAmount: number;
    price: number;          // Prix unitaire en SOL
    txHash: string;        // Hash de transaction sur la blockchain
    status: 'pending' | 'confirmed' | 'failed';
}


export interface PortfolioSettings {
    // Paramètres généraux
    minSolInWallet: number;           // Balance minimale (de sécurité) à laisser dans le portefeuille SOL
    maxConcurrentInvestments: number; // Nombre max de tokens en portefeuille simultanément
    maxSolPerToken: number;          // Montant max de SOL à investir par token
    totalPortfolioLimit: number;     // Limite totale du portefeuille en SOL

    // Paramètres d'achat automatique
    autoBuyEnabled: boolean;
    minTokenScore: number;            // Score de minimum pour achat auto
    defaultBuyAmount: number;        // Montant d'achat par défaut en SOL

    // Paramètres de vente automatique  
    autoSellEnabled: boolean;
    takeProfitPercent: number;       // % de profit pour vente partielle
    stopLossPercent: number;         // % de perte pour stop loss
    trailingStopPercent: number;     // % pour trailing stop
}


export interface PortfolioStats {
    totalValue: number;              // Valeur totale du portefeuille (SOL)
    totalInvestment: number;         // Investissement total (SOL)
    totalProfitLoss: number;         // Profit/Perte total (SOL)
    totalProfitLossPercent: number;  // Profit/Perte total (%)
    bestPerforming: {
        tokenAddress: string;
        tokenSymbol: string;
        profitLossPercent: number;
    };
    worstPerforming: {
        tokenAddress: string;
        tokenSymbol: string;
        profitLossPercent: number;
    };
    lastUpdated: Date;
}




// webapp-service.ts

export interface TradeResult {
    success?: boolean;
    message: string;
    tokenAmount?: number;
    solAmount?: number;
    error?: string;
}


export interface TokenDetailData extends Token {
    holding?: PortfolioHolding | null;
    analytics?: TokenAnalysis | null;
}


export type ServerStats = {
    tokens: number,
    tokensMax: number | null,
    trades: number,
    tradesMax: number | null,
    traders: number,
    tradersMax: number | null,
    cpuUsage: number,
    cpuLoad: number,
    ramUsage: number,
    uptime: number,
    lastUpdate: Date,
}




// trading-service.ts

export interface TradingResult {
    success: boolean;
    txHash: string;
    solAmount: number;
    tokenAmount: number;
    error?: string;
}


