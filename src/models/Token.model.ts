// Token.model.ts

import { AnalysisSummary } from "./TokenAnalysis.model";


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



export interface TokenKpi {
    priceMin: string;
    priceMax: string;
    marketCapUSDMin: number;
    marketCapUSDMax: number;
    holdersMin: number;
    holdersMax: number;
    devBalanceMin: number | null; // TODO: a remplacer par devPercentageMin
    devBalanceMax: number | null; // TODO: a remplacer par devPercentageMax
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




export type TokenMetadata = {
    //uri: string,
    name: string,
    symbol: string,
    description: string,
    image: string,
    website?: string,
    twitter?: string,
    telegram?: string,
    showName: boolean,
    createdOn: string,
}


