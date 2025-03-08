// Portfolio.model.ts


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
    price: string;          // Prix unitaire en SOL
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
    minTokenScore: number;          // Score de sécurité minimum pour achat auto
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

