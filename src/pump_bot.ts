// pump_bot.ts

import fs from 'fs';
import fetch from 'node-fetch';
import WebSocket from 'ws';

import { appConfig } from "./env";
import { WsCreateTokenResult, WsPumpMessage, WsTokenTradeResult } from './listeners/PumpWebsocketApi.listener';
import * as pumpWsApi from './lib/pumpfun/pumpfun_websocket_api';
import { Token } from './models/Token.model';
import { CreateTokenTxResult, TokenTradeTxResult } from './services/PumpListener.service';
import { Connection, VersionedTransactionResponse } from '@solana/web3.js';
import { MagicConnection } from './lib/solana/MagicConnection';
import { sleep } from './lib/utils/time.util';
import { WebsocketHandlers, WsConnection } from './lib/utils/websocket';
import { asserts } from './lib/utils/asserts';
import { retryAsync } from './lib/utils/promise.util';
import { parsePumpTransaction } from './lib/pumpfun/pumpfun_decoder';


type Status = 'idle' | 'wait_for_buy' | 'buying' | 'hold' | 'wait_for_sell' | 'selling' | 'delaying';

type Position = {
    tokenAddress: string,
    buySolAmount: number,
    buyPrice: string,
    tokenAmount: number,
    sellPrice?: string,
    sellSolAmount?: number,
    mintMessage: WsCreateTokenResult,
    tradeMessages: WsTokenTradeResult[],
}


type FastListenerCreateTokenInput = {
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


type FastListenerTradeInput = {
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


type FastListenerMessage = (FastListenerCreateTokenInput | FastListenerTradeInput | FastListenerBalanceUpdatedInput);

type FastListenerBalanceUpdatedInput = {
    type: 'updated_account_balance';
    user?: string,
    new_balance: number;
}


//let connectionUniq: Connection | null = null;
//let connectionMagic: MagicConnection | null = null;

//let currentStatus: Status = 'idle';
//let currentToken: string | null = null;
//let currentPosition: Position | null = null;

const positionsHistory: Position[] = [];

const fastListenerMints = new Map<string, FastListenerCreateTokenInput>;
const fastListenerTrades = new Map<string, FastListenerTradeInput>;


const magicRpcs = [
    //appConfig.solana.rpc.solana,
    appConfig.solana.rpc.chainstack,
    appConfig.solana.rpc.helius,
    appConfig.solana.rpc.alchemy,
    appConfig.solana.rpc.heliusJpp,
    appConfig.solana.rpc.quicknode,
    appConfig.solana.rpc.shyft,
    appConfig.solana.rpc.nownodes,
];



async function main() {
    //connectionUniq = new Connection(appConfig.solana.rpc.helius, { commitment: 'confirmed' });
    //connectionMagic = new MagicConnection({ rpcs: magicRpcs, timeout: 5_000, maxRpcs: 10, maxRetries: 10 }, { commitment: 'confirmed' });


    const bot = new PumpBot;


    if (true) {
        const connectionName = "PumpFun API WebSocket";

        const wsHandlers: WebsocketHandlers = {
            onconnect: (ws: WebSocket) => bot.startListeningForTokensMint(ws),
            onmessage: (ws: WebSocket, data: WebSocket.Data) => bot.handlePumpApiMessage(ws, data),
            onclose: (ws: WebSocket) => {
                console.log(`⚠️ WebSocket ${connectionName} closed`);
                bot.pumpfunWebsocketApi = null;
                bot.pumpfunWebsocketApiSubscriptions = null;
            },
            onerror: (ws: WebSocket, err: Error) => console.error(`❌ WebSocket ${connectionName} error: ${err.message}`),
            onreconnect: () => console.log(`📢 Tentative de reconnexion du websocket ${connectionName} ...`),
        }

        const wsPump = WsConnection(appConfig.websocketApi.url, wsHandlers);
        wsPump.connect();
    }


    if (false) {
        const connectionName = "Solana RPC WebSocket";

        const wsHandlers: WebsocketHandlers = {
            onconnect: (ws: WebSocket) => void (0),
            onmessage: (ws: WebSocket, data: WebSocket.Data) => bot.handleSolanaPumpTransactionMessage(ws, data),
            onclose: (ws: WebSocket) => console.log(`⚠️ WebSocket ${connectionName} closed`),
            onerror: (ws: WebSocket, err: Error) => console.error(`❌ WebSocket ${connectionName} error: ${err.message}`),
            onreconnect: () => console.log(`📢 Tentative de reconnexion du websocket ${connectionName} ...`),
        }

        const wsSolana = WsConnection(appConfig.fastListener.url, wsHandlers);
        wsSolana.connect();
    }


}




class PumpBot {
    private status: Status = 'idle';
    pumpfunWebsocketApi: WebSocket | null = null;
    pumpfunWebsocketApiSubscriptions: PumpfunWebsocketApiSubscriptions | null = null;
    connection: Connection | null = null;
    currentToken: string | null = null;
    currentPosition: Position | null = null;


    constructor() {
        this.connection = new Connection(appConfig.solana.rpc.chainstack, { commitment: 'confirmed' });
    }


    startListeningForTokensMint(ws?: WebSocket) {
        if (this.status !== 'idle') {
            console.warn(`Etat "idle" requis`);
            return;
        }

        if (ws) {
            // unsubscribe old websocket subscriptions
            if (this.pumpfunWebsocketApi && this.pumpfunWebsocketApi.readyState === this.pumpfunWebsocketApi.OPEN && this.pumpfunWebsocketApiSubscriptions) {
                this.pumpfunWebsocketApiSubscriptions.unsubscribeToNewTokens()
            }

            this.pumpfunWebsocketApi = ws;
        }

        if (!this.pumpfunWebsocketApi) {
            throw new Error(`Websocket manquant`);
        }

        // Souscription aux evenements "NewToken"
        this.pumpfunWebsocketApiSubscriptions = new PumpfunWebsocketApiSubscriptions(this.pumpfunWebsocketApi);
        this.pumpfunWebsocketApiSubscriptions.subscribeNewTokens();

        this.status = 'wait_for_buy';
    }


    /** Traite un message (create / buy / sell) recu sur le websocket de l'API Pump.fun */
    handlePumpApiMessage(ws: WebSocket, data: WebSocket.Data) {
        asserts(`❗ Websocket missing in handlePumpApiMessage`)
        asserts(ws === this.pumpfunWebsocketApi, `❗ Websocket mismatch in handlePumpApiMessage (${ws.url} <> ${this.pumpfunWebsocketApi?.url})`);

        try {
            const message: WsPumpMessage = JSON.parse(data.toString());

            if ('txType' in message && message.txType === 'create') {
                console.log(`${now()} [API] Received CREATE  transaction for token ${message.mint}`)
                this.handlePumpCreateTokenMessage(message as WsCreateTokenResult);
            }

            if ('txType' in message && (message.txType === 'buy' || message.txType === 'sell')) {
                this.handlePumpTradeTokenMessage(message as WsTokenTradeResult);
            }

        } catch (err: any) {
            console.warn(`❌ Erreur de décodage du message ${data.toString()}`);
        }
    }


    /** Traite un message (create) recu sur par this.handlePumpApiMessage */
    private handlePumpCreateTokenMessage(mintMessage: WsCreateTokenResult) {

        if (this.status !== 'wait_for_buy') {
            console.warn(`handlePumpCreateTokenMessage ⚠️ => Etat ${this.status} inattendu. Etat "wait_for_buy" requis. Mint ignoré`);
            return;
        }

        if (this.currentPosition) {
            console.warn(`handlePumpCreateTokenMessage ⚠️ => Mint inattendu. Une position est déjà ouverte. Mint ignoré`);
            return;
        }

        //console.log('handlePumpCreateTokenMessage', mintMessage);

        //const mintResult = retrieveMintTransactionResultWithFastListener(mintMessage.signature, 15_000);

        const retriever = () => retrieveTransactionWithRpc(this.connection, mintMessage.signature);
        //const retriever = () => retrieveMintTransactionResultWithFastListener(mintMessage.signature);

        const tsStart = Date.now();

        retriever()
            //            .then((createTokenInput: FastListenerCreateTokenInput | null) => {
            //
            //                if (createTokenInput) {
            //                    mintMessage.mintDate = new Date(createTokenInput.timestamp * 1000);
            //
            //                    const duration = Date.now() - tsStart;
            //
            //                    const tokenAge = Date.now() - mintMessage.mintDate.getTime();
            //                    console.log(`Age du token: ${tokenAge} ms (dont ${duration} ms d'attente de la transaction)`);
            //                    console.log();
            //
            //                    //autoBuy(ws, mintMessage);
            //                }
            //            })
            .then((transaction) => {
                //console.log('retriever result:', result);

                if (transaction) {
                    const transactionResult = parsePumpTransaction(transaction);
                    //console.log('transactionResult:', transactionResult)
                }

                if (transaction?.blockTime) {
                    mintMessage.mintDate = new Date(transaction.blockTime * 1000);

                    //fs.writeFileSync('/tmp/pump_tx_create_2.json', JSON.stringify(result, null, 4)); process.exit();

                    if (!this.currentPosition) {
                        this.autoBuy(mintMessage);
                    }

                } else {
                    console.warn('⚠️ No blocktime in ', transaction)
                }
            })

    }



    private handlePumpTradeTokenMessage(tradeMessage: WsTokenTradeResult) {

        if (this.status !== 'wait_for_sell') {
            console.warn(`handlePumpTradeTokenMessage ⚠️ => Etat ${this.status} inattendu. Etat "wait_for_sell" requis. Impossible de traiter le trade`);
            return;
        }

        if (!this.currentToken) {
            console.warn(`handlePumpTradeTokenMessage ⚠️ => Trade inattendu. Aucun token en position. Trade ignoré`);
            return;
        }

        if (!this.currentPosition) {
            console.warn(`handlePumpTradeTokenMessage ⚠️ => Trade inattendu. Aucune position ouverte. Trade ignoré`);
            return;
        }

        if (tradeMessage.mint !== this.currentToken) {
            console.warn(`handlePumpTradeTokenMessage ⚠️ => Trade du token ${tradeMessage.mint} inattendu. (token actif = ${this.currentToken}). Trade ignoré`);
            return;
        }

        //console.log('handlePumpTradeTokenMessage', tradeMessage);

        this.currentPosition.tradeMessages.push(tradeMessage);

        this.autoSell(tradeMessage.mint);
    }





    /** Traite un message recu (created / buy / sell / balance_update) sur le websocket Solana Fast Listener */
    handleSolanaPumpTransactionMessage(ws: WebSocket | null, data: WebSocket.Data) {
        if (!ws) return;

        let messages: FastListenerMessage[] = [];

        try {
            messages = JSON.parse(data.toString());

        } catch (err: any) {
            console.warn(`❌ Erreur de décodage du message ${data.toString()}`);
            return;
        }

        for (const message of messages) {
            if (message.type === 'created') {
                console.log(`${now()} [FST] Received CREATE  transaction for token ${message.accounts.mint}`)
                handleSolanaCreateTokenMessage(ws, message as FastListenerCreateTokenInput);
            }

            if (message.type === 'buy') {
                //console.log(`Received BUY     transaction for token ${message.accounts.mint}`)
                handleSolanaTradeTokenMessage(ws, message as FastListenerTradeInput);
            }

            if (message.type === 'sell') {
                //console.log(`Received SELL   transaction for token ${message.accounts.mint}`)
                handleSolanaTradeTokenMessage(ws, message as FastListenerTradeInput);
            }
        }
    }


    private async autoBuy(mintMessage: WsCreateTokenResult) {
        if (this.status !== 'wait_for_buy') {
            console.warn(`Invalide statut ${this.status}. Impossible d'acheter`);
            return;
        }

        const checkForBuyResult = await evaluateTokenForBuy(mintMessage);

        if (checkForBuyResult.canBuy) {
            this.pumpfunWebsocketApiSubscriptions?.unsubscribeToNewTokens();

            console.log(`Achat en cours du token ${mintMessage.mint}. Step 1/4`);

            this.status = 'buying';
            this.currentToken = mintMessage.mint;

            const buySolAmount = checkForBuyResult.amount;

            this.buyToken(buySolAmount)
                .then(() => {
                    this.currentPosition = {
                        tokenAddress: mintMessage.mint,
                        buyPrice: '0', // TODO
                        buySolAmount: 0, // TODO
                        tokenAmount: 0, // TODO
                        mintMessage,
                        tradeMessages: [], // TODO: ajouter le trade du devBuy ?
                    }

                    console.log(`Achat en cours du token ${this.currentToken}. Step 4/4`);
                    this.status = 'hold';


                    // surveiller les opportunités de vente
                    this.watchForSell(mintMessage.mint);
                })
                .catch(() => {
                    console.warn(`Achat échoué`);

                    this.status = 'idle';
                    this.currentToken = null;

                    this.status = 'delaying';
                    setTimeout(() => this.status = 'wait_for_buy', 5_000);
                })
        }
    }


    private async autoSell(tokenAddress: string) {
        if (this.status !== 'wait_for_sell') {
            console.warn(`Invalide statut ${this.status}. Impossible de vendre`);
            return;
        }

        if (!this.currentToken) {
            console.warn(`autoSell ⚠️ => Trade inattendu. Aucun token en position. Trade ignoré`);
            return;
        }

        if (!this.currentPosition) {
            console.warn(`autoSell ⚠️ => Trade inattendu. Aucune position ouverte. Trade ignoré`);
            return;
        }

        if (tokenAddress !== this.currentToken) {
            console.warn(`autoSell ⚠️ => Trade du token ${tokenAddress} inattendu. (token actif = ${this.currentToken}). Trade ignoré`);
            return;
        }


        if (this.currentPosition) {
            const checkForBuyResult = await evaluateTokenForSell(this.currentPosition);

            if (checkForBuyResult.canSell) {
                this.status = 'selling';
                const sellTokenAmount = checkForBuyResult.amount;

                console.log(); // pour cloturer la ligne dynamique

                console.log(`Vente en cours du token ${tokenAddress}. Step 1/4`);

                this.sellToken(sellTokenAmount)
                    .then(() => {
                        if (this.currentPosition) {
                            positionsHistory.push(this.currentPosition);
                            this.currentPosition = null;
                        }

                        if (this.currentToken && this.pumpfunWebsocketApiSubscriptions) {
                            this.pumpfunWebsocketApiSubscriptions.unsubscribeToTokens([this.currentToken]);
                        }

                        this.status = 'idle';
                        this.currentToken = null;

                        console.log(`Vente en cours du token ${tokenAddress}. Step 4/4`);


                        this.startListeningForTokensMint();
                    })
                    .catch(() => {
                        console.warn(`Vente échouée`);

                        this.status = 'delaying';
                        setTimeout(() => this.status = 'wait_for_sell', 5_000);
                    })

            }
        }
    }


    private watchForSell(tokenAddress: string) {

        if (this.status !== 'hold') {
            console.warn(`watchForSell ⚠️ => Etat ${this.status} inattendu. Etat "hold" requis. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentToken) {
            console.warn(`watchForSell ⚠️ => Aucun token en position. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentPosition) {
            console.warn(`watchForSell ⚠️ => Trade inattendu. Aucune position ouverte. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentPosition.mintMessage) {
            console.warn(`watchForSell ⚠️ => Message de mint manquant. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentPosition.mintMessage.mintDate) {
            console.warn(`watchForSell ⚠️ => Date de mint manquante. Surveillance des ventes abandonnée`);
            return;
        }


        console.log(`Mise en attente d'opportunité de vente du token ${this.currentToken}`);

        this.status = 'wait_for_sell';

        const watchedToken = this.currentToken;


        if (this.pumpfunWebsocketApiSubscriptions) {
            this.pumpfunWebsocketApiSubscriptions.subscribeToTokens([watchedToken]);
        }


        // TODO: afficher un message dynamique sur la console : buyPrice | buyMarketCap | currentPrice | currentMarketCap | trades | holders | gain | gainVsMaxGain | mintAge | buyAge | lastActivityAge


        const mintTime = this.currentPosition.mintMessage.mintDate;
        const buyTime = Date.now(); // À remplacer par l'heure réelle d'achat si disponible

        let lastLogTime = 0;
        let firstPrice: null | string = null;;

        const logIntervalId = setInterval(() => {
            if (watchedToken !== this.currentToken || this.status !== 'wait_for_sell') {
                clearInterval(logIntervalId);
                return;
            }

            if (Date.now() - lastLogTime < 5000) return; // Limiter l'affichage à toutes les 5 secondes
            lastLogTime = Date.now();


            const lastTrade = this.currentPosition?.tradeMessages[this.currentPosition.tradeMessages.length - 1];
            const currentPrice = lastTrade ? (lastTrade.vSolInBondingCurve / lastTrade.vTokensInBondingCurve).toFixed(10) : '0.0';
            //const currentPrice = currentPosition?.tradeMessages[currentPosition.tradeMessages.length - 1]?.price || '0';
            firstPrice = firstPrice ?? currentPrice;

            const buyPrice = firstPrice; //currentPosition?.buyPrice || '0';
            const tokenAmount = this.currentPosition?.tokenAmount || 0;
            const gain = Number(currentPrice) / Number(buyPrice) - 1;
            const mintAge = Math.round((Date.now() - mintTime.getTime()) / 1000);
            const buyAge = Math.round((Date.now() - buyTime) / 1000);

            const lastActivityAge = this.currentPosition?.tradeMessages.length
                ? Math.round((Date.now() - mintTime.getTime()) / 1000)
                : 0;

            const infos = [
                `${watchedToken.slice(0, 8)}...,`,
                `Buy: ${buyPrice} SOL,`,
                `Amount: ${tokenAmount.toFixed(0)},`,
                `Price: ${currentPrice} SOL,`,
                `Gain: ${(gain * 100).toFixed(2)}%,`,
                `Mint-age: ${mintAge}s,`,
                //`Buy-age: ${buyAge}s,`,
                `Last-age: ${lastActivityAge}s,`,
                `Holders: -1,`,
                //`Dev: -1 SOL (-1%),`,
                `Trades: ${this.currentPosition?.tradeMessages.length || 0}`,
            ]

            process.stdout.write(`\r$${infos.join(' | ')}`);


            // vérifier si opportunité de vente
            this.autoSell(tokenAddress);

        }, 1000);
    }



    private async buyToken(solAmount: number) {
        if (this.status !== 'buying') {
            console.warn(`Processus d'achat non initié`);
            return;
        }

        if (!this.currentToken) {
            console.warn(`Aucun token actif`);
            return;
        }

        if (this.currentPosition) {
            console.warn(`Une position est déjà ouverte`);
            return;
        }

        console.log(`Achat en cours du token ${this.currentToken}. Step 2/4`);

        // TODO

        // créer transaction buy
        // envoyer transaction buy
        // attendre et récupérer transaction buy
        // récupérer nouveaux soldes (SOL et tokens)


        console.log(`Achat en cours du token ${this.currentToken}. Step 3/4`);
    }


    private async sellToken(tokenAmount: number) {
        if (this.status !== 'selling') {
            console.warn(`Processus de vente non initié`);
            return;
        }

        if (!this.currentToken) {
            console.warn(`Aucun token actif. Sell annulé`);
            return;
        }

        if (!this.currentPosition) {
            console.warn(`Aucune position ouverte trouvé`);
            return;
        }

        console.log(`Vente en cours du token ${this.currentToken}. Step 2/4`);

        // TODO

        // créer transaction sell
        // envoyer transaction sell
        // attendre et récupérer transaction sell
        // récupérer nouveaux soldes (SOL et tokens)


        const sellPrice = "0"; // TODO
        const solAmount = 0; // TODO

        const positionUpdate: Partial<Position> = {
            sellPrice,
            sellSolAmount: solAmount,
        }

        Object.assign(this.currentPosition, positionUpdate);


        console.log(`Vente en cours du token ${this.currentToken}. Step 3/4`);
    }


}



async function evaluateTokenForBuy(mintMessage: WsCreateTokenResult): Promise<{ canBuy: boolean, amount: number, reason: string }> {
    if (!mintMessage) return { canBuy: false, amount: 0, reason: `Message de mint manquant` };
    if (!mintMessage.mintDate) return { canBuy: false, amount: 0, reason: `Date de mint manquante` };

    const tokenAge = Date.now() - mintMessage.mintDate.getTime();
    console.log(`👉 Age du token: ${tokenAge} ms`);
    console.log();

    // TODO: vérifier si les conditions d'achat sont remplies (age du mint, solAmount du dev, percentage du dev, nom & symbol, ...)

    if (tokenAge < 2_000) {
        return { canBuy: true, amount: 0.1, reason: `Mint récent` }

    } else {
        return { canBuy: false, amount: 0, reason: `Mint trop ancien` }
    }


    return { canBuy: false, amount: 0, reason: `Not implemented` }
}



async function evaluateTokenForSell(position: Position): Promise<{ canSell: boolean, amount: number, reason: string }> {
    asserts(position.mintMessage.mintDate, `Date de mint manquante`);

    const tokenAge = Date.now() - position.mintMessage.mintDate?.getTime()
    // TODO: vérifier si les conditions de ventes sont remplies (age, activité/inactivité, nb trades, nb holders, ventes massives, ... )

    if (tokenAge < 20_000) {
        return { canSell: false, amount: 0, reason: `Activité récente` }

    } else {
        return { canSell: true, amount: 0.1, reason: `Aucune activité récente` }
    }

    return { canSell: false, amount: 0, reason: `Not implemented` }
}








// Souscriptions


class PumpfunWebsocketApiSubscriptions {
    ws: WebSocket;

    constructor(ws: WebSocket) {
        this.ws = ws;
    }


    subscribeNewTokens() {
        pumpWsApi.subscribeNewToken(this.ws);
        console.log(`📢 Inscrit aux nouveaux tokens`);
    }


    unsubscribeToNewTokens() {
        pumpWsApi.unsubscribeNewToken(this.ws);
        console.log(`📢 Désinscrit des nouveaux tokens`);
    }


    subscribeToTokens(tokenAddresses: string[]) {
        pumpWsApi.subscribeTokenTrade(this.ws, tokenAddresses);
        console.log(`📢 Inscrit aux tokens ${tokenAddresses.join(' | ')}`);
    }


    unsubscribeToTokens(tokenAddresses: string[]) {
        pumpWsApi.unsubscribeTokenTrade(this.ws, tokenAddresses);
        console.log(`📢 Désinscrit des tokens ${tokenAddresses.join(' | ')}`);
    }

}




function handleSolanaCreateTokenMessage(ws: WebSocket, mintInput: FastListenerCreateTokenInput) {
    //console.log('FL/mintInput:', mintInput);

    if (!fastListenerMints.has(mintInput.hash)) {
        fastListenerMints.set(mintInput.hash, mintInput);
        console.log(`==> SET MINT TX for token ${mintInput.accounts.mint}`);
    }
}


function handleSolanaTradeTokenMessage(ws: WebSocket, tradeInput: FastListenerTradeInput) {
    //console.log('FL/tradeInput:', tradeInput);

    if (!fastListenerTrades.has(tradeInput.hash)) {
        fastListenerTrades.set(tradeInput.hash, tradeInput);
    }
}



async function retrieveTransactionWithRpc(connection: Connection | null, signature: string): Promise<VersionedTransactionResponse | null> {
    if (!connection) return null;

    const promise = () => connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0
    });

    //const onRetry = (attempt: number, elapsedMs: number, retryIntervalMs: number) => console.log(`retrieveTransactionWithRpc => ⚠️ Echec de la tentative ${attempt}. Temps total écoulé ${elapsedMs} ms. Nouvelle tentative dans ${retryIntervalMs} ms`);
    const onRetry = (attempt: number, elapsedMs: number, retryIntervalMs: number) => void(0);

    const resultChecker = (result: any) => result !== null;

    const transaction: VersionedTransactionResponse | null = await retryAsync(promise, 150, 2_000, onRetry, resultChecker);

    return transaction;
}



async function retrieveMintTransactionResultWithFastListener(signature: string, timeout = 15_000): Promise<FastListenerCreateTokenInput | null> {
    let mintInput: FastListenerCreateTokenInput | undefined = fastListenerMints.get(signature)
    const tsEnd = Date.now() + timeout;

    while (!mintInput && Date.now() < tsEnd) {
        mintInput = fastListenerMints.get(signature)
        if (mintInput) break;

        //console.warn(`Transaction ${signature} non trouvée dans les ${fastListenerMints.size} transactions de FastListener.`);

        await sleep(50);
    }

    return mintInput ?? null;
}



function now(date?: Date) {
    //return (date ?? new Date).toLocaleTimeString('fr-FR', { timeStyle: 'medium', second: 'numeric' });
    return (date ?? new Date).toISOString()
        .replace('Z', '')
        .replace('T', ' ');
}





/* ######################################################### */


// Démarrer le programme
main().catch((err: any) => {
    console.error('Erreur fatale:', err);
    process.exit(1);
});


