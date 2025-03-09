// pump_bot.ts

import WebSocket from 'ws';
import { Connection, Keypair, VersionedTransactionResponse } from '@solana/web3.js';

import { appConfig } from "./env";
import { sleep } from './lib/utils/time.util';
import { retryAsync } from './lib/utils/promise.util';
import { WebsocketHandlers, WsConnection } from './lib/utils/websocket';
import { asserts } from './lib/utils/asserts';
import * as pumpWsApi from './lib/pumpfun/pumpfun_websocket_api';
import { parsePumpTransaction, PumpTokenInfo, TradeInfo } from './lib/pumpfun/pumpfun_decoder';
import { buildPortalBuyTransaction, buildPortalSellTransaction } from './lib/pumpfun/pumpfun_web_api';
import { sendSolanaTransaction } from './lib/solana/transaction';

import type { TransactionResult } from './services/Trading.service';
import type { WsCreateTokenResult, WsPumpMessage, WsTokenTradeResult } from './listeners/PumpWebsocketApi.listener';


/* ######################################################### */


type Status = 'idle' | 'wait_for_buy' | 'buying' | 'hold' | 'wait_for_sell' | 'selling' | 'delaying';

type Position = {
    tokenAddress: string,
    buySolAmount: number,
    buyPrice: string,
    tokenAmount: number, // holding // string ?
    sellPrice?: string,
    sellSolAmount?: number,
    //mintMessage: WsCreateTokenResult,
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


/* ######################################################### */


const positionsHistory: Position[] = [];

const fastListenerMints = new Map<string, FastListenerCreateTokenInput>;
const fastListenerTrades = new Map<string, FastListenerTradeInput>;


/* ######################################################### */


async function main() {

    const wallet = Keypair.generate();
    const bot = new PumpBot(wallet);


    if (true) {
        const connectionName = "PumpFun API WebSocket";

        const wsHandlers: WebsocketHandlers = {
            onconnect: (ws: WebSocket) => bot.startListeningForTokensMint(ws),
            onmessage: (ws: WebSocket, data: WebSocket.Data) => bot.handlePumpApiMessage(ws, data),
            onclose: (ws: WebSocket) => {
                console.log(`⚠️ WebSocket ${connectionName} closed`);
                bot.destroyWebsocket();
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
    private wallet: Keypair;

    private pumpfunWebsocketApi: WebSocket | null = null;
    private pumpfunWebsocketApiSubscriptions: PumpfunWebsocketApiSubscriptions | null = null;
    private connection: Connection | null = null;
    private currentToken: string | null = null;
    private currentPosition: Position | null = null;
    private tokenInfos: PumpTokenInfo | null = null;


    constructor(wallet: Keypair) {
        this.connection = new Connection(appConfig.solana.rpc.chainstack, { commitment: 'confirmed' });
        this.wallet = wallet;
    }


    startListeningForTokensMint(ws?: WebSocket) {
        if (this.status !== 'idle') {
            console.warn(`Etat "idle" requis`);
            return;
        }

        if (ws) {
            // unsubscribe old websocket subscriptions
            if (this.pumpfunWebsocketApi && this.pumpfunWebsocketApi.readyState === this.pumpfunWebsocketApi.OPEN && this.pumpfunWebsocketApiSubscriptions) {
                this.pumpfunWebsocketApiSubscriptions.unsubscribeNewTokens()
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


    destroyWebsocket() {
        this.pumpfunWebsocketApi = null;
        this.pumpfunWebsocketApiSubscriptions = null;
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
            console.warn(`handlePumpCreateTokenMessage ⚠️ => Etat "${this.status}" inattendu. Etat "wait_for_buy" requis. Mint ignoré`);
            return;
        }

        if (this.currentPosition) {
            console.warn(`handlePumpCreateTokenMessage ⚠️ => Mint inattendu. Une position est déjà ouverte. Mint ignoré`);
            return;
        }


        if (this.connection) {
            getTransaction(this.connection, mintMessage.signature)
                .then((transaction) => {
                    if (transaction) {
                        const tokenInfos = parsePumpTransaction(transaction) as PumpTokenInfo;
                        //console.log('tokenInfos:', tokenInfos)

                        if (!this.currentPosition) {
                            this.autoBuy(mintMessage, tokenInfos);
                        }
                    }
                })

        }

    }


    private handlePumpTradeTokenMessage(tradeMessage: WsTokenTradeResult) {

        if (this.status !== 'wait_for_sell') {
            //console.warn(`handlePumpTradeTokenMessage ⚠️ => Etat "${this.status}" inattendu. Etat "wait_for_sell" requis. Impossible de traiter le trade`);
            return;
        }

        if (!this.currentToken) {
            console.warn(`handlePumpTradeTokenMessage ⚠️ => Trade inattendu. Aucun token en position. Trade ignoré`);
            return;
        }

        if (!this.tokenInfos) {
            console.warn(`handlePumpTradeTokenMessage ⚠️ => Trade inattendu. Aucune infos sur le token selectionné. Trade ignoré`);
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

        this.autoSell(this.tokenInfos);
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


    private async autoBuy(mintMessage: WsCreateTokenResult, tokenInfos: PumpTokenInfo) {
        if (this.status !== 'wait_for_buy') {
            console.warn(`autoBuy ⚠️ => Invalide statut ${this.status}. Impossible d'acheter`);
            return;
        }

        if (this.currentToken) {
            console.warn(`autoBuy ⚠️ => Un token est déjà en position. Achat annulé`);
            return;
        }

        if (this.currentPosition) {
            console.warn(`autoBuy ⚠️ => Une position est déjà ouverte. Achat annulé`);
            return;
        }

        const checkForBuyResult = await evaluateTokenForBuy(mintMessage, tokenInfos);

        if (checkForBuyResult.canBuy) {

            if (this.pumpfunWebsocketApiSubscriptions) {
                this.pumpfunWebsocketApiSubscriptions.unsubscribeNewTokens();

                this.pumpfunWebsocketApiSubscriptions.subscribeToTokens([mintMessage.mint]);
            }

            this.status = 'buying';
            this.currentToken = mintMessage.mint;
            this.tokenInfos = tokenInfos;

            const buySolAmount = checkForBuyResult.amount;

            this.buyToken(tokenInfos, buySolAmount)
                .then(() => {
                    // surveiller les opportunités de vente
                    this.watchForSell(tokenInfos);
                })
                .catch((err: any) => {
                    console.warn(`❌ Achat échoué. ${err.message}`);

                    this.status = 'idle';
                    this.currentToken = null;

                    this.status = 'delaying';
                    setTimeout(() => this.status = 'wait_for_buy', 5_000);

                    if (this.pumpfunWebsocketApiSubscriptions) {
                        this.pumpfunWebsocketApiSubscriptions.unsubscribeToTokens([mintMessage.mint]);

                        this.pumpfunWebsocketApiSubscriptions.subscribeNewTokens();
                    }
                })
        }
    }


    private async autoSell(tokenInfos: PumpTokenInfo) {
        if (this.status !== 'wait_for_sell') {
            console.warn(`autoSell ⚠️ => Invalide statut ${this.status}. Vente annulée`);
            return;
        }

        if (!this.currentToken) {
            console.warn(`autoSell ⚠️ => Aucun token en position. Vente annulée`);
            return;
        }

        if (!this.currentPosition) {
            console.warn(`autoSell ⚠️ => Aucune position ouverte. Vente annulée`);
            return;
        }

        if (tokenInfos.tokenAddress !== this.currentToken) {
            console.warn(`autoSell ⚠️ => Trade du token ${tokenInfos.tokenAddress} inattendu. (token actif = ${this.currentToken}). Vente annulée`);
            return;
        }


        if (this.currentPosition) {
            const checkForBuyResult = await evaluateTokenForSell(this.currentPosition, tokenInfos);

            if (checkForBuyResult.canSell) {
                this.status = 'selling';
                const sellTokenAmount = checkForBuyResult.amount;

                this.sellToken(tokenInfos.tokenAddress, sellTokenAmount)
                    .then(() => {
                        // Ré-écouter les mint de tokens
                        this.startListeningForTokensMint();
                    })
                    .catch((err: any) => {
                        console.warn(`❌ Vente échouée. ${err.message}`);

                        this.status = 'delaying';
                        setTimeout(() => this.status = 'wait_for_sell', 5_000);
                    })

            }
        }
    }


    private watchForSell(tokenInfos: PumpTokenInfo) {

        if (this.status !== 'hold') {
            console.warn(`watchForSell ⚠️ => Etat "${this.status}" inattendu. Etat "hold" requis. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentToken) {
            console.warn(`watchForSell ⚠️ => Aucun token en position. Surveillance des ventes abandonnée`);
            return;
        }

        if (tokenInfos.tokenAddress !== this.currentToken) {
            console.warn(`watchForSell ⚠️ => Token inattendu. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentPosition) {
            console.warn(`watchForSell ⚠️ => Aucune position ouverte. Surveillance des ventes abandonnée`);
            return;
        }


        console.log(`Mise en attente d'opportunité de vente du token ${this.currentToken}`);

        this.status = 'wait_for_sell';


        // TODO: afficher un message dynamique sur la console : buyPrice | buyMarketCap | currentPrice | currentMarketCap | trades | holders | gain | gainVsMaxGain | mintAge | buyAge | lastActivityAge


        const mintTime = tokenInfos.createdAt;
        const buyTime = Date.now(); // À remplacer par l'heure réelle d'achat si disponible

        let lastLogTime = 0;
        let firstPrice: null | string = null;
        const watchedToken = this.currentToken;


        const logIntervalId = setInterval(() => {
            if (watchedToken !== this.currentToken || this.status !== 'wait_for_sell') {
                console.warn(`watchForSell ⚠️ => Changement du contexte. Surveillance des ventes stoppée`);
                clearInterval(logIntervalId);
                return;
            }

            if (Date.now() - lastLogTime < 1000) return; // Limiter l'affichage à 1 refresh par seconde
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
            this.autoSell(tokenInfos);

        }, 1000);

        console.log();
    }



    private async buyToken(tokenInfos: PumpTokenInfo, solAmount: number) {
        if (this.status !== 'buying') {
            console.warn(`buyToken ⚠️ => Processus d'achat non initié`);
            return;
        }

        if (!this.currentToken) {
            console.warn(`buyToken ⚠️ => Aucun token actif. Achat annulé`);
            return;
        }

        if (tokenInfos.tokenAddress !== this.currentToken) {
            console.warn(`buyToken ⚠️ => Achat sur le mauvais token. Achat annulé`);
            return;
        }

        if (this.currentPosition) {
            console.warn(`buyToken ⚠️ => Une position est déjà ouverte. Achat annulé`);
            return;
        }

        if (! this.connection) {
            console.warn(`buyToken ⚠️ => Aucune connexion solana/web3 ouverte. Achat annulé`);
            return;
        }


        console.log(`Achat en cours du token ${this.currentToken}. Step 1/3`);

        // TODO

        // 1) créer transaction buy
        const tx = await buildPortalBuyTransaction(this.wallet.publicKey, this.currentToken, solAmount);
        //console.log('buy tx:', tx);

        console.log(`Achat en cours du token ${this.currentToken}. Step 2/3`);

        // 2) envoyer transaction buy
        //const txResult: TransactionResult = await sendSolanaTransaction(this.connection, this.wallet, tx);
        const txResult: TransactionResult = { success: true, signature: '37TptP3nTLXMrm5QshwRdUZnh3eWi2U99KiifUm3dAzhCNKyxjAG62kYM6Gw7RXPkq2JJvGRNbFroJuZG98WDHUN' }; // DEBUG

        if (! txResult.success || !txResult.signature) {
            /*
            console.warn(`Erreur pendant l'achat`);

            if (txResult.error) {
                console.warn(` - message: ${txResult.error.transactionMessage}`);

                txResult.error.transactionLogs.forEach(log => {
                    console.warn(` - log: ${log}`);
                })

                //console.log('ERR', txResult.error.transactionError)
            }
            */

            throw new Error(`Erreur pendant l'achat. ${txResult.error?.transactionMessage ?? txResult.error?.message ?? ''}`);
        }

        // 3) attendre et récupérer transaction buy
        const txResponseResult = txResult.results ?? await getTransaction(this.connection, txResult.signature);

        // 4) Décoder la transaction et récupérer les nouveaux soldes (SOL et tokens)
        if (!txResponseResult) throw new Error(`Erreur de décodage de la transaction d'achat`);
        const pumpResult = parsePumpTransaction(txResponseResult) as TradeInfo;


        this.currentPosition = {
            tokenAddress: this.currentToken,
            buyPrice: pumpResult.price,
            buySolAmount: pumpResult.solAmount,
            tokenAmount: pumpResult.tokenAmount,
            tradeMessages: [], // TODO: ajouter les trades existants + le miens
        }

        this.status = 'hold';

        console.log(`Achat en cours du token ${this.currentToken}. Step 3/3`);
    }


    private async sellToken(tokenAddress: string, tokenAmount: number) {
        if (this.status !== 'selling') {
            console.warn(`sellToken ⚠️ => Processus de vente non initié`);
            return;
        }

        if (!this.currentToken) {
            console.warn(`sellToken ⚠️ => Aucun token actif. Vente annulée`);
            return;
        }

        if (tokenAddress !== this.currentToken) {
            console.warn(`sellToken ⚠️ => Vente du mauvais token. Vente annulée`);
            return;
        }

        if (!this.currentPosition) {
            console.warn(`sellToken ⚠️ => Aucune position ouverte. Vente annulée`);
            return;
        }

        if (! this.connection) {
            console.warn(`buyToken ⚠️ => Aucune connexion solana/web3 ouverte. Achat annulé`);
            return;
        }


        console.log(); // pour cloturer la ligne dynamique
        console.log();

        console.log(`Vente en cours du token ${this.currentToken}. Step 1/3`);

        // TODO

        // 1) créer transaction sell
        const tx = await buildPortalSellTransaction(this.wallet.publicKey, this.currentToken, tokenAmount);
        //console.log('sell tx:', tx);

        console.log(`Vente en cours du token ${this.currentToken}. Step 2/3`);

        // 2) envoyer transaction sell
        //const txResult: TransactionResult = await sendSolanaTransaction(this.connection, this.wallet, tx);
        const txResult: TransactionResult = { success: true, signature: '5jpctgtMZuHEMtbD7VdB5MMzJwCnWgM7191M7zpr4RxehP6mNHeYDRYwswEWUxyukZqvSi2TTYn24TiNVFm2PYUH' }; // DEBUG

        if (! txResult.success || !txResult.signature) {
            /*
            console.warn(`Erreur pendant la vente`);

            if (txResult.error) {
                console.warn(` - message: ${txResult.error.transactionMessage}`);

                txResult.error.transactionLogs.forEach(log => {
                    console.warn(` - log: ${log}`);
                })

                //console.log('ERR', txResult.error.transactionError)
            }
            */

            throw new Error(`Erreur pendant la vente. ${txResult.error?.transactionMessage ?? txResult.error?.message ?? ''}`);
        }

        // 3) attendre et récupérer transaction sell
        const txResponseResult = txResult.results ?? await getTransaction(this.connection, txResult.signature);

        // 4) Décoder la transaction et récupérer les nouveaux soldes (SOL et tokens)
        if (!txResponseResult) throw new Error(`Erreur de décodage de la transaction de vente`);
        const pumpResult = parsePumpTransaction(txResponseResult) as TradeInfo;


        const positionUpdate: Partial<Position> = {
            sellPrice: pumpResult.price,
            sellSolAmount: pumpResult.solAmount,
            tokenAmount: pumpResult.tokenAmount,
            // TODO: calcul profit
        }

        Object.assign(this.currentPosition, positionUpdate);


        positionsHistory.push(this.currentPosition);
        this.currentPosition = null;

        if (this.pumpfunWebsocketApiSubscriptions) {
            this.pumpfunWebsocketApiSubscriptions.unsubscribeToTokens([this.currentToken]);
        }


        console.log(`Vente en cours du token ${this.currentToken}. Step 3/3`);

        this.status = 'idle';
        this.currentToken = null;
    }

}



async function evaluateTokenForBuy(mintMessage: WsCreateTokenResult, tokenInfos: PumpTokenInfo): Promise<{ canBuy: boolean, amount: number, reason: string }> {
    if (!mintMessage) return { canBuy: false, amount: 0, reason: `Message de mint manquant` };
    if (!mintMessage.mintDate) return { canBuy: false, amount: 0, reason: `Date de mint manquante` };

    const tokenAge = Date.now() - tokenInfos.createdAt.getTime();
    console.log(`👉 Age du token: ${tokenAge} ms`);
    console.log();

    const devBuySolAmount = tokenInfos.initialBuy?.solAmount ?? 0;
    const devBuyTokenAmount = tokenInfos.initialBuy?.tokenAmount ?? 0;
    const devBuyTokenPercentage = tokenInfos.initialBuy?.traderPostPercentToken ?? 0;

    // TODO: vérifier si les conditions d'achat sont remplies (age du mint, solAmount du dev, percentage du dev, nom & symbol, ...)

    const ageScore = tokenAge <= 1
            ? 80
            : tokenAge <= 2
                ? 60
                : tokenAge <= 3
                    ? 50
                    : tokenAge <= 5
                        ? 40
                        : 20;

    let buySolScore = devBuySolAmount <= 0.1
            ? 80
            : devBuySolAmount <= 0.5
                ? 60
                : devBuySolAmount <= 1
                    ? 40
                    : 20;

    let buyTokenPercentage = devBuyTokenPercentage <= 1
            ? 80
            : devBuyTokenPercentage <= 2
                ? 60
                : devBuyTokenPercentage <= 5
                    ? 40
                    : 20;


    // Calculer le score global avec pondérations
    const weightedScore = [
        [ageScore, 0.40],
        [buySolScore, 0.30],
        [buyTokenPercentage, 0.30],
    ];

    // Arrondir le score
    const weightTotals = weightedScore.reduce((p, c) => p + c[1], 0);
    const scoreTotals = weightedScore.reduce((p, c) => p + c[0] * c[1], 0);
    const finalScore = Math.round(scoreTotals / weightTotals);

    console.log('weightedScore:', weightedScore)
    console.log('finalScore:', finalScore)

    if (finalScore >= 60) {
        return { canBuy: true, amount: 0.1, reason: `Conditions d'achat OK` }

    } else {
        return { canBuy: false, amount: 0, reason: `Conditions d'achat non satisfaites` }
    }


    return { canBuy: false, amount: 0, reason: `Not implemented` }
}



async function evaluateTokenForSell(position: Position, tokenInfos: PumpTokenInfo): Promise<{ canSell: boolean, amount: number, reason: string }> {

    const tokenAge = Date.now() - tokenInfos.createdAt?.getTime()
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


    unsubscribeNewTokens() {
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



async function getTransaction(connection: Connection, signature: string) {
    const retriever = () => retrieveTransactionWithRpc(connection, signature);
    //const retriever = () => retrieveMintTransactionResultWithFastListener(signature);

    return retriever();
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


