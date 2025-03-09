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
import base58 from 'bs58';
import { MagicConnection } from './lib/solana/MagicConnection';


/* ######################################################### */


type Status = 'idle' | 'wait_for_buy' | 'buying' | 'hold' | 'wait_for_sell' | 'selling' | 'delaying';


type SelectedToken = {
    tokenAddress: string,
    mintMessage: WsCreateTokenResult,
    tradesMessages: WsTokenTradeResult[],
    holders: Map<string, number>;
};

type Position = {
    tokenAddress: string,
    buySolAmount: number,
    buyPrice: string,
    tokenAmount: number, // holding // string ?
    sellPrice?: string,
    sellSolAmount?: number,
    checkedBalance: { amount: number, lastUpdated: Date } | null,
    profit: number | null,
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


type BotSettings = {
    minSolInWallet?: number;
    defaultBuyAmount?: number;
    minBuyAmount?: number;
    maxBuyAmount?: number;
    scoreMinForBuy?: number;
    scoreMinForSell?: number;
    stopLimit?: number;
    trailingStop?: number;
}


/* ######################################################### */


const positionsHistory: Position[] = [];

const fastListenerMints = new Map<string, FastListenerCreateTokenInput>;
const fastListenerTrades = new Map<string, FastListenerTradeInput>;

const botSettings: BotSettings = {
    minSolInWallet: 0.05,    // 7.5 $
    defaultBuyAmount: 0.01,  // 1.5 $
    minBuyAmount: 0.005,     // 0.75 $
    maxBuyAmount: 0.1,       //  15 $
    scoreMinForBuy: 60,
    scoreMinForSell: 60,
    stopLimit: 20,    // 20% => si on est en perte de plus de 20%
    trailingStop: 80, // 80% => si le prix est plus bas que 80% du max qu'on a connu
}

/* ######################################################### */


async function main() {

    const wallet: Keypair = appConfig.solana.WalletPrivateKey ? Keypair.fromSecretKey(base58.decode(appConfig.solana.WalletPrivateKey)) : Keypair.generate();

    const bot = new PumpBot(wallet, botSettings);


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
    private settings: BotSettings | undefined;

    private pumpfunWebsocketApi: WebSocket | null = null;
    private pumpfunWebsocketApiSubscriptions: PumpfunWebsocketApiSubscriptions | null = null;
    private connection: Connection | null = null;
    private currentToken: SelectedToken | null = null;
    private currentPosition: Position | null = null;
    private tokenInfos: PumpTokenInfo | null = null;
    private lastSlot: number | null = null;
    private solBalance: { amount: number, lastUpdated: Date } | null = null;


    constructor(wallet: Keypair, botSettings?: BotSettings) {
        this.connection = new Connection(appConfig.solana.rpc.chainstack, { commitment: 'confirmed',  });
        this.wallet = wallet;
        this.settings = botSettings;

        this.connection.getBalance(this.wallet.publicKey)
            .then(balanceSol => {
                this.solBalance = { amount: balanceSol / 1e9, lastUpdated: new Date };
                console.log(`PumpBot 📢 => Balance Sol mise à jour : ${this.solBalance.amount.toFixed(9)} SOL`);
            });

        console.log(`PumpBot 📢 => Bot démarré sur le wallet ${this.wallet.publicKey.toBase58()}`);
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

                        } else {
                            console.warn(`handlePumpCreateTokenMessage ⚠️ => Transaction inattendue. Une position est déjà ouverte. Transaction ignorée`);
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

        if (tradeMessage.mint !== this.currentToken.tokenAddress) {
            console.warn(`handlePumpTradeTokenMessage ⚠️ => Trade du token ${tradeMessage.mint} inattendu. (token actif = ${this.currentToken.tokenAddress}). Trade ignoré`);
            return;
        }

        //console.log('handlePumpTradeTokenMessage', tradeMessage);

        this.currentToken.tradesMessages.push(tradeMessage);

        // mise à jour des balances des holders
        const tokenAmountDiff = tradeMessage.tokenAmount * ((tradeMessage.txType === 'buy') ? 1 : -1);
        const holderTokenAmount = this.currentToken.holders.get(tradeMessage.traderPublicKey) || 0;
        this.currentToken.holders.set(tradeMessage.traderPublicKey, holderTokenAmount + tokenAmountDiff);
        if (holderTokenAmount + tokenAmountDiff === 0) this.currentToken.holders.delete(tradeMessage.traderPublicKey);

        this.tokenInfos.price = (tradeMessage.vSolInBondingCurve / tradeMessage.vTokensInBondingCurve).toFixed(10);
        this.tokenInfos.virtualSolReserves = tradeMessage.vSolInBondingCurve;
        this.tokenInfos.virtualTokenReserves = tradeMessage.vTokensInBondingCurve;
        this.tokenInfos.lastUpdated = new Date; // tradeMessage.timestamp;
        this.tokenInfos.marketCapSol = tradeMessage.marketCapSol;


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

        const minSolInWalletDefault = 0.001;

        const maxSolAmount = (this.solBalance?.amount ?? 0) - (this.settings?.minSolInWallet ?? minSolInWalletDefault);

        const checkForBuyResult = await this.evaluateTokenForBuy(mintMessage, tokenInfos, maxSolAmount);

        if (checkForBuyResult.canBuy) {
            console.log(`autoBuy 📢 => Recommandation d'achat':`, checkForBuyResult);

            if (this.pumpfunWebsocketApiSubscriptions) {
                this.pumpfunWebsocketApiSubscriptions.unsubscribeNewTokens();

                this.pumpfunWebsocketApiSubscriptions.subscribeToTokens([mintMessage.mint]);

            } else {
                console.warn(`autoBuy ⚠️ => Souscriptions websocket non disponibles. Achat annulé`);
                return;
            }


            this.status = 'buying';
            this.currentToken = { tokenAddress: mintMessage.mint, mintMessage, tradesMessages: [], holders: new Map };
            this.tokenInfos = tokenInfos;

            const buySolAmount = checkForBuyResult.amount; // TODO: Math.min(balanceSol, checkForBuyResult.amount)
            const minSolInWalletDefault = 0.001;

            if (this.settings?.minSolInWallet && buySolAmount > this.settings?.minSolInWallet) {
                console.warn(`autoBuy ⚠️ => Montant demandé supérieur à la somme disponible. Achat annulé`);
                return;
            }

            if (this.settings?.minBuyAmount && buySolAmount < this.settings?.minBuyAmount) {
                console.warn(`autoBuy ⚠️ => Montant demandé inférieur au minimum autorisé. Achat annulé`);
                return;
            }

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

        if (tokenInfos.tokenAddress !== this.currentToken.tokenAddress) {
            console.warn(`autoSell ⚠️ => Trade du token ${tokenInfos.tokenAddress} inattendu. (token actif = ${this.currentToken.tokenAddress}). Vente annulée`);
            return;
        }


        if (this.currentPosition) {
            const checkForSellResult = await this.evaluateTokenForSell(this.currentToken, this.currentPosition, tokenInfos);

            if (checkForSellResult.canSell) {
                console.log(`autoSell => 📢 Recommandation de vente:`, checkForSellResult);

                this.status = 'selling';
                const sellTokenAmount = checkForSellResult.amount;

                this.sellToken(tokenInfos.tokenAddress, sellTokenAmount)
                    .then(() => {
                        // Ré-écouter les mint de tokens
                        //this.startListeningForTokensMint(); // désactivé pour debug
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

        if (tokenInfos.tokenAddress !== this.currentToken.tokenAddress) {
            console.warn(`watchForSell ⚠️ => Token inattendu. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentPosition) {
            console.warn(`watchForSell ⚠️ => Aucune position ouverte. Surveillance des ventes abandonnée`);
            return;
        }


        console.log(`Mise en attente d'opportunité de vente du token ${this.currentToken.tokenAddress}`);

        this.status = 'wait_for_sell';


        const mintTime = tokenInfos.createdAt;
        const buyTime = Date.now(); // À remplacer par l'heure réelle d'achat si disponible

        let lastLogTime = 0;
        let firstPrice: null | string = null;
        const watchedTokenAddress = this.currentToken.tokenAddress;


        const logIntervalId = setInterval(() => {
            if (watchedTokenAddress !== this.currentToken?.tokenAddress || this.status !== 'wait_for_sell') {
                console.warn(`watchForSell ⚠️ => Changement du contexte. Surveillance des ventes stoppée`);
                clearInterval(logIntervalId);
                return;
            }

            if (Date.now() - lastLogTime < 1000) return; // Limiter l'affichage à 1 refresh par seconde
            lastLogTime = Date.now();


            const lastTrade = this.currentToken?.tradesMessages[this.currentToken.tradesMessages.length - 1];
            const currentPrice = lastTrade ? (lastTrade.vSolInBondingCurve / lastTrade.vTokensInBondingCurve).toFixed(10) : '0.0';
            //const currentPrice = currentPosition?.tradesMessages[currentPosition.tradesMessages.length - 1]?.price || '0';
            firstPrice = firstPrice ?? currentPrice;

            const buyPrice = firstPrice; //currentPosition?.buyPrice || '0';
            const tokenAmount = this.currentPosition?.tokenAmount || 0;
            const gain = Number(currentPrice) / Number(buyPrice) - 1;
            const mintAge = Math.round((Date.now() - mintTime.getTime()) / 1000);
            const buyAge = Math.round((Date.now() - buyTime) / 1000);

            //const lastActivityAge = this.currentToken?.tradesMessages.length
            //    ? Math.round((Date.now() - mintTime.getTime()) / 1000)
            //    : 0;
            const lastActivityAge = Date.now() - tokenInfos.lastUpdated.getTime();

            const infos = [
                `${watchedTokenAddress.slice(0, 8)}...,`,
                `Buy: ${buyPrice} SOL,`,
                `Amount: ${tokenAmount.toFixed(0)},`,
                `Price: ${currentPrice} SOL,`,
                `Gain: ${(gain * 100).toFixed(2)}%,`,
                `Mint-age: ${mintAge}s,`,
                //`Buy-age: ${buyAge}s,`,
                `Last-age: ${lastActivityAge}s,`,
                `Holders: -1,`,
                //`Dev: -1 SOL (-1%),`,
                `Trades: ${this.currentToken?.tradesMessages.length || 0}`,
            ]

            // afficher un message dynamique sur la console : buyPrice | buyMarketCap | currentPrice | currentMarketCap | trades | holders | gain | gainVsMaxGain | mintAge | buyAge | lastActivityAge

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

        if (tokenInfos.tokenAddress !== this.currentToken.tokenAddress) {
            console.warn(`buyToken ⚠️ => Achat sur le mauvais token. Achat annulé`);
            return;
        }

        if (this.currentPosition) {
            console.warn(`buyToken ⚠️ => Une position est déjà ouverte. Achat annulé`);
            return;
        }

        if (!this.connection) {
            console.warn(`buyToken ⚠️ => Aucune connexion solana/web3 ouverte. Achat annulé`);
            return;
        }


        console.log(`${now()} Achat en cours du token ${this.currentToken.tokenAddress}. Step 1/3`);


        // 1) créer transaction buy
        const tx = await buildPortalBuyTransaction(this.wallet.publicKey, this.currentToken.tokenAddress, solAmount);
        //console.log('buy tx:', tx);

        console.log(`${now()} Achat en cours du token ${this.currentToken.tokenAddress}. Step 2/3`);


        // 2) envoyer transaction buy
        const txResult: TransactionResult = await sendSolanaTransaction(this.connection, this.wallet, tx);

        // test
        //const txResult: TransactionResult = { success: true, signature: '37TptP3nTLXMrm5QshwRdUZnh3eWi2U99KiifUm3dAzhCNKyxjAG62kYM6Gw7RXPkq2JJvGRNbFroJuZG98WDHUN' }; // DEBUG


        if (!txResult.success || !txResult.signature) {
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

        console.log("Attente Transaction: https://solscan.io/tx/" + txResult.signature);


        // 3) attendre et récupérer transaction buy
        const txResponseResult = txResult.results ?? await getTransaction(this.connection, txResult.signature);

        console.log(`✅ Transaction d'achat récupérée`);


        // 4) Décoder la transaction et récupérer les nouveaux soldes (SOL et tokens)
        if (!txResponseResult) throw new Error(`Erreur de décodage de la transaction d'achat`);
        const pumpResult = parsePumpTransaction(txResponseResult) as TradeInfo;

        console.log(`✅ Transaction d'achat décodée`);


        // Mise à jour des balances
        const checkedTokenBalance = { amount: pumpResult.traderPostBalanceToken, lastUpdated: pumpResult.timestamp };
        console.log(`buyToken 📢 => Balance Token mise à jour : ${checkedTokenBalance.amount.toFixed(9)} ${tokenInfos.tokenSymbol}`);

        this.solBalance = { amount: pumpResult.traderPostBalanceSol, lastUpdated: pumpResult.timestamp };
        console.log(`buyToken 📢 => Balance Sol mise à jour : ${this.solBalance.amount.toFixed(9)} SOL`);


        // Création de la position
        this.currentPosition = {
            tokenAddress: this.currentToken.tokenAddress,
            buyPrice: pumpResult.price,
            buySolAmount: pumpResult.solAmount,
            tokenAmount: pumpResult.tokenAmount,
            checkedBalance: checkedTokenBalance,
            profit: null,
        }

        this.status = 'hold';

        console.log(`${now()} Achat en cours du token ${this.currentToken.tokenAddress}. Step 3/3`);
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

        if (tokenAddress !== this.currentToken.tokenAddress) {
            console.warn(`sellToken ⚠️ => Vente du mauvais token. Vente annulée`);
            return;
        }

        if (!this.currentPosition) {
            console.warn(`sellToken ⚠️ => Aucune position ouverte. Vente annulée`);
            return;
        }

        if (!this.connection) {
            console.warn(`sellToken ⚠️ => Aucune connexion solana/web3 ouverte. Achat annulé`);
            return;
        }


        console.log(); // pour cloturer la ligne dynamique
        console.log();

        console.log(`${now()} Vente en cours du token ${tokenAddress}. Step 1/3`);

        // TODO

        // 1) créer transaction sell
        const tx = await buildPortalSellTransaction(this.wallet.publicKey, tokenAddress, tokenAmount);
        //console.log('sell tx:', tx);

        console.log(`${now()} Vente en cours du token ${tokenAddress}. Step 2/3`);


        // 2) envoyer transaction sell
        const txResult: TransactionResult = await sendSolanaTransaction(this.connection, this.wallet, tx);

        // test
        //const txResult: TransactionResult = { success: true, signature: '5jpctgtMZuHEMtbD7VdB5MMzJwCnWgM7191M7zpr4RxehP6mNHeYDRYwswEWUxyukZqvSi2TTYn24TiNVFm2PYUH' }; // DEBUG


        if (!txResult.success || !txResult.signature) {
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

        console.log("Attente Transaction: https://solscan.io/tx/" + txResult.signature);


        // 3) attendre et récupérer transaction sell
        const txResponseResult = txResult.results ?? await getTransaction(this.connection, txResult.signature);

        console.log(`✅ Transaction de vente récupérée`);


        // 4) Décoder la transaction et récupérer les nouveaux soldes (SOL et tokens)
        if (!txResponseResult) throw new Error(`Erreur de décodage de la transaction de vente`);
        const pumpResult = parsePumpTransaction(txResponseResult) as TradeInfo;

        console.log(`✅ Transaction de vente décodée`);


        // Mise à jour de la position
        const positionUpdate: Partial<Position> = {
            sellPrice: pumpResult.price,
            sellSolAmount: pumpResult.solAmount,
            tokenAmount: pumpResult.tokenAmount,
            profit: 100 * (Number(pumpResult.price) - Number(this.currentPosition.buyPrice)) / Number(this.currentPosition.buyPrice),
        }

        Object.assign(this.currentPosition, positionUpdate);


        // Mise à jour des souscriptions websocket
        if (this.pumpfunWebsocketApiSubscriptions) {
            this.pumpfunWebsocketApiSubscriptions.unsubscribeToTokens([tokenAddress]);
        }


        // Mise à jour des balances
        const checkedTokenBalance = { amount: pumpResult.traderPostBalanceToken, lastUpdated: pumpResult.timestamp };
        console.log(`sellToken 📢 => Balance Token mise à jour : ${checkedTokenBalance.amount.toFixed(9)} ${this.currentToken.mintMessage.symbol}`);

        this.solBalance = { amount: pumpResult.traderPostBalanceSol, lastUpdated: pumpResult.timestamp };
        console.log(`sellToken 📢 => Balance Sol mise à jour : ${this.solBalance.amount.toFixed(9)} SOL`);


        if (checkedTokenBalance.amount !== 0) {
            console.warn(`Solde de tokens non nul après la vente. Process stoppé pour analyse.`);
            process.exit();
        }

        // Historise la position
        positionsHistory.push(this.currentPosition);
        this.currentPosition = null;


        this.status = 'idle';
        this.currentToken = null;

        console.log(`${now()} Vente en cours du token ${tokenAddress}. Step 3/3`);
    }



    private async evaluateTokenForBuy(mintMessage: WsCreateTokenResult, tokenInfos: PumpTokenInfo, maxSolAmount: number): Promise<{ canBuy: boolean, amount: number, reason: string }> {
        if (!mintMessage) return { canBuy: false, amount: 0, reason: `Message de mint manquant` };
        if (!tokenInfos) return { canBuy: false, amount: 0, reason: `Infos du token manquantes` };

        const tokenAge = Date.now() - tokenInfos.createdAt.getTime();
        console.log(`👉 Age du token: ${tokenAge} ms`);
        console.log();

        const devBuySolAmount = tokenInfos.initialBuy?.solAmount ?? 0;
        const devBuyTokenAmount = tokenInfos.initialBuy?.tokenAmount ?? 0;
        const devBuyTokenPercentage = tokenInfos.initialBuy?.traderPostPercentToken ?? 0;

        // vérifie si les conditions d'achat sont remplies (age du mint, solAmount du dev, percentage du dev, nom & symbol, ...)

        const ageScore = tokenAge <= 1_000
            ? 80
            : tokenAge <= 2_000
                ? 60
                : tokenAge <= 3_000
                    ? 50
                    : tokenAge <= 5_000
                        ? 40
                        : 20;

        let buySolScore = devBuySolAmount <= 0.1
            ? 80
            : devBuySolAmount <= 0.5
                ? 60
                : devBuySolAmount <= 1
                    ? 40
                    : 20;

        let buyTokenPercentageScore = devBuyTokenPercentage <= 1
            ? 80
            : devBuyTokenPercentage <= 2
                ? 60
                : devBuyTokenPercentage <= 5
                    ? 40
                    : 20;


        // Calculer le score global avec pondérations
        const weightedScore = [
            [ageScore, 40],
            [buySolScore, 30],
            [buyTokenPercentageScore, 30],
        ];

        // Arrondir le score
        const weightTotals = weightedScore.reduce((p, c) => p + c[1], 0);
        const scoreTotals = weightedScore.reduce((p, c) => p + c[0] * c[1], 0);
        const finalScore = Math.round(scoreTotals / weightTotals);

        console.log(`${now()} evaluateTokenForBuy => weightedScore:`, weightedScore, '=>', finalScore)

        const scoreNormalized = 100 * (finalScore - (this.settings?.scoreMinForBuy ?? 60)) / (100 - (this.settings?.scoreMinForBuy ?? 60));

        if (finalScore >= (this.settings?.scoreMinForBuy ?? 60)) {
            const defaultAmount = this.settings?.defaultBuyAmount ?? 0.01;
            const minAmount = Math.max(defaultAmount * 0.5, this.settings?.minBuyAmount ?? defaultAmount * 0.5);
            const maxAmount = Math.min(defaultAmount * 1.5, this.settings?.maxBuyAmount ?? defaultAmount * 1.5);
            const [min, max] = [minAmount, Math.min(maxAmount, maxSolAmount)];
            const solAmount = min + scoreNormalized * (max - min) / 100;

            if (max <= min || solAmount <= 0) {
                console.warn(`${now()} evaluateTokenForBuy ⚠️ => Balance SOL insuffisante`);
                return { canBuy: false, amount: 0, reason: `Balance SOL insuffisante` }
            }

            return { canBuy: true, amount: solAmount, reason: `Score d'achat satisfaisant` }

        } else {
            return { canBuy: false, amount: 0, reason: `Conditions d'achat non satisfaites` }
        }
    }



    private async evaluateTokenForSell(selectedToken: SelectedToken, position: Position, tokenInfos: PumpTokenInfo): Promise<{ canSell: boolean, amount: number, reason: string }> {
        if (!tokenInfos) return { canSell: false, amount: 0, reason: `Infos du token manquantes` };

        // vérifie si les conditions de ventes sont remplies (age, activité/inactivité, nb trades, nb holders, ventes massives, ... )

        const lastTrades100 = selectedToken.tradesMessages.slice(-100);
        const lastTrades10 = lastTrades100.slice(-10);
        const lastTrades10Buy = lastTrades10.filter(trade => trade.txType === 'buy').length;
        const lastTrades10Sell = lastTrades10.length - lastTrades10Buy;
        const lastTradesBuyPercent = 25 + (100 * lastTrades10Buy / lastTrades10.length) / 2; // score normalisé entre 25% et 75%

        const minPrice = Math.min(...lastTrades100.map(trade => trade.vSolInBondingCurve / trade.vTokensInBondingCurve));
        const refPrice = Math.max(minPrice, Number(position.buyPrice));
        const maxPrice = Math.max(...lastTrades100.map(trade => trade.vSolInBondingCurve / trade.vTokensInBondingCurve));

        const priceOffset = maxPrice - refPrice;
        const currentPrice = Number(tokenInfos.price);
        const percentOfAth = priceOffset ? (100 * (currentPrice - refPrice) / Math.abs(priceOffset)) : 0;
        const profit = 100 * (currentPrice - Number(position.buyPrice)) / Number(position.buyPrice);

        const tokenAge = Date.now() - tokenInfos.createdAt?.getTime()
        const inactivityAge = Date.now() - tokenInfos.lastUpdated?.getTime()

        console.log() // ferme la ligne dynamique
        console.log(`tokenAge = ${tokenAge} ms | inactivityAge = ${inactivityAge}ms | profit = ${profit.toFixed(2)} % | percentOfAth = ${percentOfAth.toFixed(2)} %`)

        const sellScore = percentOfAth < 0
            ? 90
            : percentOfAth > 0 && percentOfAth < 40
                ? 80
                : percentOfAth > 0 && percentOfAth < 60
                    ? 70
                    : percentOfAth > 0 && percentOfAth < 80
                        ? 40
                        : 20

        const inactivityScore = inactivityAge >= 30_000
            ? 75
            : inactivityAge >= 10_000
                ? 60
                : inactivityAge >= 5_000
                    ? 50
                    : inactivityAge >= 3_000
                        ? 40
                        : 30;

        const ageScore = tokenAge >= 120_000
            ? 70
            : tokenAge >= 60_000
                ? 60
                : tokenAge >= 30_000
                    ? 50
                    : tokenAge >= 10_000
                        ? 40
                        : 30;

        const weightedScore = [
            [sellScore, 40],
            [inactivityScore, 30],
            [ageScore, 30],
            [lastTradesBuyPercent, 50],
        ];

        // Arrondir le score
        const weightTotals = weightedScore.reduce((p, c) => p + c[1], 0);
        const scoreTotals = weightedScore.reduce((p, c) => p + c[0] * c[1], 0);
        const finalScore = Math.round(scoreTotals / weightTotals);

        console.log(); // ferme la ligne dynamique
        console.log(`${now()} evaluateTokenForSell => weightedScore:`, weightedScore, '=>', finalScore)


        let tokenAmount = position.tokenAmount;

        if (position.tokenAmount <= 0) {
            console.warn(`${now()} evaluateTokenForSell ⚠️ => Balance Token insuffisante`);
            return { canSell: false, amount: 0, reason: `Balance Token insuffisante` }
        }


        if (finalScore >= (this.settings?.scoreMinForSell ?? 60)) {
            return { canSell: true, amount: tokenAmount, reason: `Score de ventes satisfaisant` }

        } else if (profit < -(this.settings?.stopLimit ?? 20)) {
            return { canSell: true, amount: tokenAmount, reason: `Stop Limit` };

        } else if (percentOfAth > 0 && percentOfAth < (this.settings?.trailingStop ?? 80)) {
            return { canSell: true, amount: tokenAmount, reason: `Trailing Stop` }

        } else {
            return { canSell: false, amount: 0, reason: `Condition de ventes non satisfaites` }
        }
    }


}








// Souscriptions


class PumpfunWebsocketApiSubscriptions {
    ws: WebSocket;

    constructor(ws: WebSocket) {
        this.ws = ws;
    }


    subscribeNewTokens() {
        pumpWsApi.subscribeNewToken(this.ws);
        console.log(`${now()} 📢 Inscrit aux nouveaux tokens`);
    }


    unsubscribeNewTokens() {
        pumpWsApi.unsubscribeNewToken(this.ws);
        console.log(`${now()} 📢 Désinscrit des nouveaux tokens`);
    }


    subscribeToTokens(tokenAddresses: string[]) {
        pumpWsApi.subscribeTokenTrade(this.ws, tokenAddresses);
        console.log(`${now()} 📢 Inscrit aux tokens ${tokenAddresses.join(' | ')}`);
    }


    unsubscribeToTokens(tokenAddresses: string[]) {
        pumpWsApi.unsubscribeTokenTrade(this.ws, tokenAddresses);
        console.log(`${now()} 📢 Désinscrit des tokens ${tokenAddresses.join(' | ')}`);
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
    const onRetry = (attempt: number, elapsedMs: number, retryIntervalMs: number) => void (0);

    const resultChecker = (result: any) => result !== null;

    const transaction: VersionedTransactionResponse | null = await retryAsync(promise, 200, 2_000, onRetry, resultChecker);

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


