// env.ts

import { config } from 'dotenv';
config({ path: `${__dirname}/../.env` });


/* ######################################################### */


const RpcList = {
    'solana': process.env.RPC_SOLANA ?? '',
    'helius': process.env.RPC_HELIUS ?? process.env.RPC_SOLANA ?? '',
    'heliusJpp': process.env.RPC_HELIUSJPP ?? process.env.RPC_SOLANA ?? '',
    'quicknode': process.env.RPC_QUICKNODE ?? process.env.RPC_SOLANA ?? '',
    'alchemy': process.env.RPC_ALCHEMY ?? process.env.RPC_SOLANA ?? '',
    'drpc': process.env.RPC_DRPC ?? process.env.RPC_SOLANA ?? '',
    'chainstack': process.env.RPC_CHAINSTACK ?? process.env.RPC_SOLANA ?? '',
    'shyft': process.env.RPC_SHYFT ?? process.env.RPC_SOLANA ?? '',
    'nownodes': process.env.RPC_NOWNODES ?? process.env.RPC_SOLANA ?? '',
    'getblock': process.env.RPC_GETBLOCK ?? process.env.RPC_SOLANA ?? '',
    'rockx': process.env.RPC_ROCKX ?? '', // slow
    'syndica': process.env.RPC_SYNDICA ?? '', // very slow
    'lavanet': process.env.RPC_LAVANET ?? '', // very slow
    'omnia': process.env.RPC_OMNIA ?? '', // very slow
    //'tatum': process.env.RPC_TATUM ?? '', // KO
    //'ankr': process.env.RPC_ANKR ?? '', // KO
};


export const appConfig: AppConfig = {
    mongodb: {
        uri: process.env.MONGODB_URI || '', //'mongodb://localhost:27017',
        dbName: 'pump_monitor_v2',
    },
    solana: {
        rpc: RpcList,
        websocket: process.env.SOLANA_WS || 'ws://api.mainnet-beta.solana.com',
        WalletPrivateKey: process.env.WALLET_PRIVATE_KEY || '',
    },
    fastListener: {
        url: 'ws://localhost:5715',
        pingInterval: 15_000,  // 15 secondes
    },
    websocketApi: {
        url: 'wss://pumpportal.fun/api/data',
        pingInterval: 15_000,  // 15 secondes
    },
    websocketFrontend: {
        url: 'wss://frontend-api.pump.fun/socket.io/?EIO=4&transport=websocket',
        //URL: 'wss://frontend-api-v3.pump.fun/socket.io/?EIO=4&transport=websocket',
        pingInterval: 15_000,  // 15 secondes
    },
    analysis: {
        milestonesUSD: [
            10_000,  // 10k
            30_000,  // 30k
            50_000,  // 50k
            75_000,  // 75k
            100_000  // 100k
        ],
        trendsWindows: {
            ULTRA_SHORT: 10 * 1000,   // 10 secondes
            VERY_SHORT: 30 * 1000,    // 30 secondes
            SHORT: 2 * 60 * 1000,     // 2 minutes
            MEDIUM: 5 * 60 * 1000     // 5 minutes
        }
    },
    trading: {
        autoTrading: false,
        autoBuyEnabled: true,
        autoSellEnabled: true,
        // amounts
        minSolInWallet: 0.05,
        maxSolPerToken: 0.1,
        totalPortfolioLimit: 1.0,
        // buy conditions
        defaultBuyAmount: 0.01,
        minTokenScore: 60,
        maxConcurrentInvestments: 1,
        // sell conditions
        takeProfitPercent: 50,
        stopLossPercent: 10,
        trailingStopPercent: 75,
    },
};



/* ######################################################### */


export type AppConfig = {
    mongodb: {
        uri: string;
        dbName: string;
    };
    solana: {
        rpc: Record<keyof typeof RpcList, string>;
        websocket: string;
        WalletPrivateKey: string;
    };
    fastListener: {
        url: string;
        pingInterval: number;  // ms
    };
    websocketApi: {
        url: string;
        pingInterval: number;  // ms
    };
    websocketFrontend: {
        url: string,
        pingInterval: number,  // ms
    };
    analysis: {
        milestonesUSD: number[];
        trendsWindows: {
            ULTRA_SHORT: number;
            VERY_SHORT: number;
            SHORT: number;
            MEDIUM: number;
        };
    };
    trading: {
        autoTrading: boolean,
        minSolInWallet: number,
        maxConcurrentInvestments: number,
        maxSolPerToken: number,
        totalPortfolioLimit: number,
        autoBuyEnabled: boolean,
        minTokenScore: number,
        defaultBuyAmount: number,
        autoSellEnabled: boolean,
        takeProfitPercent: number,
        stopLossPercent: number,
        trailingStopPercent: number,
    };
}


