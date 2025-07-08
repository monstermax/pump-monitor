// trader.ts


export interface TraderTrade {
    timestamp: Date;
    tokenAddress: string;
    type: 'create' | 'buy' | 'sell';
    solAmount: number;
    tokenAmount: number;
    profit?: number;
}


export interface Trader {
    address: string;
    trades: TraderTrade[];
    performance: {
        totalProfit: number;
        successRate: number;
        avgHoldTime: number;
    };
}
