
import type { WsCreateTokenResult, WsTokenTradeResult } from '../monitor/listeners/PumpWebsocketApi.listener';


export type Status = 'idle' | 'wait_for_buy' | 'buying' | 'hold' | 'wait_for_sell' | 'selling' | 'delaying';


export type SelectedToken = {
    tokenAddress: string,
    mintMessage: WsCreateTokenResult,
    tradesMessages: WsTokenTradeResult[],
    holders: Map<string, number>;
};

export type Position = {
    tokenAddress: string,
    preBalance: number,
    postBalance: number | null,
    recommandedSolAmount: number,
    buySolCost: number, // montant réel dépensé (frais/taxes inclus) => postBalance - preBalance
    buySolAmount: number, // montant dépensé pour le swap (hors taxes) => tokenAmount * tokenPrice
    buyPrice: string,
    tokenAmount: number, // holding // string ?
    sellPrice?: string,
    sellSolAmount?: number,   // montant recu par le swap (hors taxes)  => tokenAmount * tokenPrice
    sellSolReward?: number | null, // montant réel recu (frais/taxes inclus) => postBalance - preBalance
    checkedBalance: { amount: number, lastUpdated: Date } | null,
    profit: number | null,
    timestamp: Date,
}

export type TokenKpis = {
    buyPrice: string,
    tokenAmount: number,
    currentPrice: string,
    profit: number,
    mintAge: number,
    weightedScore: number[][],
    finalScore: number,
    percentOfAth: number,
    lastTrades3BuyPercent: number,
    lastTrades5BuyPercent: number,
    minPrice: number,
    maxPrice: number,
}

export type FastListenerCreateTokenInput = {
    type: 'created';
    hash: string;
    accounts: {
        mint: string;
        bonding_curve: string;
        associated_bonding_curve: string;
        global: string;
        user: string;
    };
    index: number;
    timestamp: number;
}


export type FastListenerTradeInput = {
    sol_amount: number;
    token_amount: number;
    is_buy: boolean;
    virtual_token_reserves: number;
    virtual_sol_reserves: number;
    user: string;
    timestamp: number;
    type: 'sell' | 'buy';
    accounts: {
        global: string;
        fee: string;
        mint: string;
        bonding_curve: string;
        associated_bonding_curve: string;
        associated_user: string;
        user: string;
    };
    hash: string;
    index: number;
};


export type FastListenerMessage = (FastListenerCreateTokenInput | FastListenerTradeInput | FastListenerBalanceUpdatedInput);

export type FastListenerBalanceUpdatedInput = {
    type: 'updated_account_balance';
    user?: string,
    new_balance: number;
}


export type BotSettings = {
    minSolInWallet?: number;
    defaultBuyAmount?: number;
    minBuyAmount?: number;
    maxBuyAmount?: number;
    scoreMinForBuy?: number;
    scoreMinForSell?: number;
    stopLimit?: number;
    takeProfit?: number;
    trailingStop?: number;
}
