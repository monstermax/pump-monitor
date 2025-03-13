// pump_indexer.ts

import { log, warn, error } from "./lib/utils/console";
import { ServiceManager } from "./monitor/managers/Service.manager";
import { PumpFunIndexer } from "./monitor/services/PumpFunIndexer.service";
import { CreateTokenTxResult, TokenTradeTxResult } from "./monitor/services/PumpListener.service";
import MySQLClient from "./lib/utils/mysql";
import { appConfig } from "./env";


/* ######################################################### */


async function main() {

    log(`Indexer démarré`);

    const db = appConfig.mysql.host ? new MySQLClient({
            host: appConfig.mysql.host,
            user: appConfig.mysql.user,
            password: appConfig.mysql.password,
            database: appConfig.mysql.db,
        }) : fakeDatabase()


    const indexer = new PumpFunIndexer(new ServiceManager);

    let tradesQueue: TokenTradeTxResult[] = [];


    indexer.on('create', async (newTokenData: CreateTokenTxResult, initialBuy?: TokenTradeTxResult) => {
        log(`Mint ${newTokenData.mint} ${initialBuy ? `(dev ${initialBuy.solAmount.toFixed(3)} SOL)` : ''}`);

        // save data
        await db.insert('tokens', newTokenData);

        if (initialBuy) {
            await db.insert('trades', initialBuy);
        }
    })

    indexer.on('trade', async (tradeTokenData: TokenTradeTxResult, hasSeenMint?: boolean) => {
        if (!hasSeenMint) return;

        log(`Trade ${tradeTokenData.txType} ${tradeTokenData.mint} ${tradeTokenData.solAmount.toFixed(3)} SOL`);

        // save data
        //await db.insert('trades', tradeTokenData);
        tradesQueue.push(tradeTokenData)

        //console.log('tradeTokenData:', tradeTokenData); process.exit()


        //const tokenUpdate = {
        //    vTokensInBondingCurve: tradeTokenData.vTokensInBondingCurve,
        //    vSolInBondingCurve: tradeTokenData.vSolInBondingCurve,
        //    price: tradeTokenData.vSolInBondingCurve / tradeTokenData.vTokensInBondingCurve,
        //    marketCapSol: tradeTokenData.marketCapSol,
        //    updatedAt: tradeTokenData.timestamp,
        //}

        //await db.update('tokens', tokenUpdate, `mint = '${tradeTokenData.mint}'`);

    })

    indexer.start();



    const dequeueIntoDb = async () => {
        if (tradesQueue.length > 0) {
            if (tradesQueue.length > 10 || (tradesQueue.at(-1)?.timestamp.getTime() || 0) < Date.now() - 1_000) {
                const inserts = tradesQueue.slice(0);
                tradesQueue = [];

                await db.insertMultiple('trades', inserts);
                console.log(`${inserts.length} trades inserted`)
            }
        }


        setTimeout(dequeueIntoDb, 500);
    }


    //dequeueIntoDb();

}


function fakeDatabase() {
    const insert = (tableName: string, data: any) => console.log('insert:', data);
    const insertMultiple = (tableName: string, data: any[]) => console.log('insertMultiple:', data);
    const update = (tableName: string, data: any, whereClause: string, whereParams: any[] = []) => console.log('update:', data);

    return {
        insert,
        insertMultiple,
        update,
    }
}


/* ######################################################### */


// Démarrer le programme
main().catch((err: any) => {
    console.error('Erreur fatale:', err);
    process.exit(1);
});


