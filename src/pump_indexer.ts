// pump_indexer.ts

import { Context, ParsedBlockResponse } from "@solana/web3.js";

import { log, warn, error } from "./lib/utils/console";
import { ServiceManager } from "./monitor/managers/Service.manager";
import { PumpFunIndexer } from "./monitor/services/PumpFunIndexer.service";
import { CreateTokenTxResult, TokenTradeTxResult } from "./monitor/services/PumpListener.service";
import MySQLClient from "./lib/utils/mysql";


/* ######################################################### */


export interface BlockNotification {
    jsonrpc: string;
    method: string;
    params: {
        result: {
            context: Context;
            value: {
                slot: number;
                err: any;
                block: ParsedBlockResponse;
            };
        };
        subscription: number;
    };
}


export type Block = ParsedBlockResponse;


/* ######################################################### */


async function main() {

    log(`Indexer démarré`);

    const db = new MySQLClient({
        host: 'localhost',
        user: 'pyramidial',
        password: 'pyramidial',
        database: 'pumpfun_indexer'
    });


    const indexer = new PumpFunIndexer(new ServiceManager);

    indexer.on('create', async (newTokenData: CreateTokenTxResult, initialBuy?: TokenTradeTxResult) => {
        log(`Mint ${newTokenData.mint} ${initialBuy ? `(dev ${initialBuy.solAmount.toFixed(3)} SOL)` : ''}`);

        // save data
        await db.insert('tokens', newTokenData);

        if (initialBuy) {
            await db.insert('trades', initialBuy);
        }
    })

    indexer.on('trade', async (tradeTokenData: TokenTradeTxResult) => {
        log(`Trade ${tradeTokenData.txType} ${tradeTokenData.mint} ${tradeTokenData.solAmount.toFixed(3)} SOL`);

        // save data
        await db.insert('trades', tradeTokenData);

        const tokenUpdate = {
            vTokensInBondingCurve: tradeTokenData.vTokensInBondingCurve,
            vSolInBondingCurve: tradeTokenData.vSolInBondingCurve,
            marketCapSol: tradeTokenData.marketCapSol,
        }

        await db.update('tokens', tokenUpdate, `mint = '${tradeTokenData.mint}'`);
    })

    indexer.start();

}





/* ######################################################### */


// Démarrer le programme
main().catch((err: any) => {
    console.error('Erreur fatale:', err);
    process.exit(1);
});


