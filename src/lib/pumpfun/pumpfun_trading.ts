// pumpfun_trading.ts


export type TradeTransactionResult = {
    type: 'buy' | 'sell';
    tokenAmount: number;
    solAmount: number;
    mint: string;
    success: boolean;
};



/* ######################################################### */



export function calculateWithSlippageBuy(amount: bigint, basisPoints: bigint) {
    return amount + (amount * basisPoints) / 10000n;
};


export function calculateWithSlippageSell(amount: bigint, basisPoints: bigint) {
    return amount - (amount * basisPoints) / 10000n;
};

