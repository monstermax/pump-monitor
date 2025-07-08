// token.ts

import { Trade } from "../types/server.types";

export interface TokenData {
    address: string;
    name: string;
    createdAt: Date;
    marketCap: number;
    devBuySolAmount: number | null;
    devBuyTokenAmount: number;
    trades: Trade[];
    holders: {
        address: string;
        tokenBalance: number;
        percentage: number;
        lastUpdate: Date;
        type: 'dev' | 'bondingCurve' | 'trader';
    }[];
}
