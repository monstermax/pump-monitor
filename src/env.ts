// env.ts

import { config } from 'dotenv';
config({ path: `${__dirname}/../.env` });


/* ######################################################### */


const RpcList = {
    'solana': process.env.RPC_SOLANA ?? '',
    'helius': process.env.RPC_HELIUS ?? '',
    'heliusJpp': process.env.RPC_HELIUSJPP ?? '',
    'quicknode': process.env.RPC_QUICKNODE ?? '',
    'alchemy': process.env.RPC_ALCHEMY ?? '',
    'drpc': process.env.RPC_DRPC ?? '',
    'getblock': process.env.RPC_GETBLOCK ?? '',
    //'tatum': process.env.RPC_TATUM ?? '',
    //'ankr': process.env.RPC_ANKR ?? '',
    //'pokt': process.env.RPC_POKT ?? '',
    'chainstack': process.env.RPC_CHAINSTACK ?? '',
    'shyft': process.env.RPC_SHYFT ?? '',
    'nownodes': process.env.RPC_NOWNODES ?? '',
    'rockx': process.env.RPC_ROCKX ?? '',
    'syndica': process.env.RPC_SYNDICA ?? '',
    'lavanet': process.env.RPC_LAVANET ?? '',
    'omnia': process.env.RPC_OMNIA ?? '',
};


export const appConfig: AppConfig = {
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
        dbName: 'pump_monitor_v2',
    },
    solana: {
        rpc: RpcList,
        websocket: process.env.SOLANA_WS || 'ws://api.mainnet-beta.solana.com',
        WalletPrivateKey: process.env.WALLET_PRIVATE_KEY || '',
    },
    fastListener: {
        URL: 'ws://localhost:5715',
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
    pumpfun: {
        PUMP_PROGRAM: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        PUMP_MINT: 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM',
        PUMP_TOKEN: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        PUMP_TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
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
        minSolInWallet: 0.05,
        maxConcurrentInvestments: 1,
        maxSolPerToken: 0.1,
        totalPortfolioLimit: 1.0,
        // buy
        autoBuyEnabled: true,
        minTokenScore: 60,
        defaultBuyAmount: 0.01,
        // sell
        autoSellEnabled: true,
        takeProfitPercent: 300,
        stopLossPercent: 30,
        trailingStopPercent: 15, // pas utilisé
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
        URL: string;
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
    pumpfun: {
        PUMP_PROGRAM: string,
        PUMP_MINT: string,
        PUMP_TOKEN: string,
        PUMP_TOKEN_2022: string,
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


