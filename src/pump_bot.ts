// pump_bot.ts

import WebSocket from 'ws';
import { Connection, Keypair, VersionedTransactionResponse } from '@solana/web3.js';

import { appConfig } from "./env";
import { getTime, sleep } from './lib/utils/time.util';
import { retryAsync } from './lib/utils/promise.util';
import { WebsocketHandlers, WsConnection } from './lib/utils/websocket';
import { asserts } from './lib/utils/asserts';
import * as pumpWsApi from './lib/pumpfun/pumpfun_websocket_api';
import { parsePumpTransaction, PumpTokenInfo, TradeInfo } from './lib/pumpfun/pumpfun_decoder';
import { buildPortalBuyTransaction, buildPortalSellTransaction } from './lib/pumpfun/pumpfun_web_api';
import { getDynamicPriorityFee, sendSolanaTransaction } from './lib/solana/transaction';

import type { TransactionResult } from './services/Trading.service';
import type { WsCreateTokenResult, WsPumpMessage, WsTokenTradeResult } from './listeners/PumpWebsocketApi.listener';
import base58 from 'bs58';
import { MagicConnection } from './lib/solana/MagicConnection';
import { formatAddress } from './lib/solana/account';
import { padCenter } from './lib/utils/text.utils';


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
    preBalance: number,
    postBalance: number | null,
    recommandedSolAmount: number,
    //buySolCost: number, // montant réel dépensé (frais/taxes inclus) => postBalance - preBalance
    buySolAmount: number, // montant dépensé pour le swap (hors taxes) => tokenAmount * tokenPrice
    buyPrice: string,
    tokenAmount: number, // holding // string ?
    sellPrice?: string,
    sellSolAmount?: number,   // montant recu par le swap (hors taxes)  => tokenAmount * tokenPrice
    //sellSolReward?: number, // montant réel recu (frais/taxes inclus) => postBalance - preBalance
    checkedBalance: { amount: number, lastUpdated: Date } | null,
    profit: number | null,
    timestamp: Date,
}

type TokenKpis = {
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
    takeProfit?: number;
    trailingStop?: number;
}


/* ######################################################### */


const positionsHistory: Position[] = [];

const fastListenerMints = new Map<string, FastListenerCreateTokenInput>;
const fastListenerTrades = new Map<string, FastListenerTradeInput>;

const botSettings: BotSettings = {
    minSolInWallet: 0.05,
    defaultBuyAmount: 0.1,
    minBuyAmount: 0.05,
    maxBuyAmount: 0.15,
    scoreMinForBuy: 60,
    scoreMinForSell: 60,
    stopLimit: 20,    // 20% => si on est en perte de plus de 20%
    takeProfit: 50,   // 50% => si on est en profit de plus de 30%
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
                log(`⚠️ WebSocket ${connectionName} closed`);
                bot.destroyWebsocket();
            },
            onerror: (ws: WebSocket, err: Error) => error(`${now()} ❌ WebSocket ${connectionName} error: ${err.message}`),
            onreconnect: () => log(`📢 Tentative de reconnexion du websocket ${connectionName} ...`),
        }

        const wsPump = WsConnection(appConfig.websocketApi.url, wsHandlers);
        wsPump.connect();
    }


    if (false) {
        const connectionName = "Solana RPC WebSocket";

        const wsHandlers: WebsocketHandlers = {
            onconnect: (ws: WebSocket) => void (0),
            onmessage: (ws: WebSocket, data: WebSocket.Data) => bot.handleSolanaPumpTransactionMessage(ws, data),
            onclose: (ws: WebSocket) => log(`⚠️ WebSocket ${connectionName} closed`),
            onerror: (ws: WebSocket, err: Error) => error(`${now()} ❌ WebSocket ${connectionName} error: ${err.message}`),
            onreconnect: () => log(`📢 Tentative de reconnexion du websocket ${connectionName} ...`),
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
    private currentKpis: TokenKpis | null = null;
    private tokenInfos: PumpTokenInfo | null = null;
    //private lastSlot: number | null = null;
    private solBalance: { amount: number, lastUpdated: Date } | null = null;
    private priorityFee: number = 0.0001;
    private slippage: number = 10;


    constructor(wallet: Keypair, botSettings?: BotSettings) {
        this.connection = new Connection(appConfig.solana.rpc.chainstack, { commitment: 'confirmed',  });
        this.wallet = wallet;
        this.settings = botSettings;

        this.connection.getBalance(this.wallet.publicKey)
            .then(balanceSol => {
                this.solBalance = { amount: balanceSol / 1e9, lastUpdated: new Date };
                log(`PumpBot 📢 => Balance Sol mise à jour : ${this.solBalance.amount.toFixed(9)} SOL`);
            });

        getDynamicPriorityFee(this.connection)
            .then(priorityFee => this.priorityFee = priorityFee)

        log(`PumpBot 📢 => Bot démarré sur le wallet ${this.wallet.publicKey.toBase58()}`);
    }


    startListeningForTokensMint(ws?: WebSocket) {
        if (this.status !== 'idle') {
            warn(`${now()} Etat "idle" requis`);
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
                //log(`[API] Received CREATE  transaction for token ${message.mint}`)
                this.handlePumpCreateTokenMessage(message as WsCreateTokenResult);
            }

            if ('txType' in message && (message.txType === 'buy' || message.txType === 'sell')) {
                this.handlePumpTradeTokenMessage(message as WsTokenTradeResult);
            }

        } catch (err: any) {
            warn(`${now()} ❌ Erreur de décodage du message ${data.toString()}`);
        }
    }


    /** Traite un message (create) recu sur par this.handlePumpApiMessage */
    private handlePumpCreateTokenMessage(mintMessage: WsCreateTokenResult) {

        if (this.status !== 'wait_for_buy') {
            warn(`${now()} handlePumpCreateTokenMessage ⚠️ => Etat "${this.status}" inattendu. Etat "wait_for_buy" requis. Mint ignoré`);
            return;
        }

        if (this.currentPosition) {
            warn(`${now()} handlePumpCreateTokenMessage ⚠️ => Mint inattendu. Une position est déjà ouverte. Mint ignoré`);
            return;
        }


        if (this.connection) {
            getTransaction(this.connection, mintMessage.signature)
                .then((transaction) => {
                    if (transaction) {
                        const tokenInfos = parsePumpTransaction(transaction) as PumpTokenInfo;
                        //log('tokenInfos:', tokenInfos)

                        if (!this.currentPosition) {
                            this.autoBuy(mintMessage, tokenInfos);

                        } else {
                            warn(`${now()} handlePumpCreateTokenMessage ⚠️ => Transaction inattendue. Une position est déjà ouverte. Transaction ignorée`);
                        }
                    }
                })

        }

    }


    private handlePumpTradeTokenMessage(tradeMessage: WsTokenTradeResult) {

        if (this.status !== 'wait_for_sell') {
            //warn(`${now()} handlePumpTradeTokenMessage ⚠️ => Etat "${this.status}" inattendu. Etat "wait_for_sell" requis. Impossible de traiter le trade`);
            return;
        }

        if (!this.currentToken) {
            warn(`${now()} handlePumpTradeTokenMessage ⚠️ => Trade inattendu. Aucun token en position. Trade ignoré`);
            return;
        }

        if (!this.tokenInfos) {
            warn(`${now()} handlePumpTradeTokenMessage ⚠️ => Trade inattendu. Aucune infos sur le token selectionné. Trade ignoré`);
            return;
        }

        if (!this.currentPosition) {
            warn(`${now()} handlePumpTradeTokenMessage ⚠️ => Trade inattendu. Aucune position ouverte. Trade ignoré`);
            return;
        }

        if (tradeMessage.mint !== this.currentToken.tokenAddress) {
            warn(`${now()} handlePumpTradeTokenMessage ⚠️ => Trade du token ${tradeMessage.mint} inattendu. (token actif = ${this.currentToken.tokenAddress}). Trade ignoré`);
            return;
        }

        //log('handlePumpTradeTokenMessage', tradeMessage);

        tradeMessage.timestamp = new Date;

        this.currentToken.tradesMessages.push(tradeMessage);

        // mise à jour des balances des holders
        const tokenAmountDiff = tradeMessage.tokenAmount * ((tradeMessage.txType === 'buy') ? 1 : -1);
        const holderTokenAmount = this.currentToken.holders.get(tradeMessage.traderPublicKey) || 0;
        this.currentToken.holders.set(tradeMessage.traderPublicKey, holderTokenAmount + tokenAmountDiff);
        if (holderTokenAmount + tokenAmountDiff === 0) this.currentToken.holders.delete(tradeMessage.traderPublicKey);

        this.tokenInfos.price = (tradeMessage.vSolInBondingCurve / tradeMessage.vTokensInBondingCurve).toFixed(10);
        this.tokenInfos.virtualSolReserves = tradeMessage.vSolInBondingCurve;
        this.tokenInfos.virtualTokenReserves = tradeMessage.vTokensInBondingCurve;
        this.tokenInfos.lastUpdated = tradeMessage.timestamp;
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
            warn(`${now()} ❌ Erreur de décodage du message ${data.toString()}`);
            return;
        }

        for (const message of messages) {
            if (message.type === 'created') {
                //log(`[FST] Received CREATE  transaction for token ${message.accounts.mint}`)
                handleSolanaCreateTokenMessage(ws, message as FastListenerCreateTokenInput);
            }

            if (message.type === 'buy') {
                //log(`Received BUY     transaction for token ${message.accounts.mint}`)
                handleSolanaTradeTokenMessage(ws, message as FastListenerTradeInput);
            }

            if (message.type === 'sell') {
                //log(`Received SELL   transaction for token ${message.accounts.mint}`)
                handleSolanaTradeTokenMessage(ws, message as FastListenerTradeInput);
            }
        }
    }



    private async autoBuy(mintMessage: WsCreateTokenResult, tokenInfos: PumpTokenInfo) {
        if (this.status !== 'wait_for_buy') {
            //warn(`${now()} autoBuy ⚠️ => Invalide statut ${this.status}. Impossible d'acheter`);
            return;
        }

        if (this.currentToken) {
            warn(`${now()} autoBuy ⚠️ => Un token est déjà en position => Achat annulé`);
            return;
        }

        if (this.currentPosition) {
            warn(`${now()} autoBuy ⚠️ => Une position est déjà ouverte => Achat annulé`);
            return;
        }

        const minSolInWalletDefault = 0.001;

        const maxSolAmount = (this.solBalance?.amount ?? 0) - (this.settings?.minSolInWallet ?? minSolInWalletDefault);

        const checkForBuyResult = await this.evaluateTokenForBuy(mintMessage, tokenInfos, maxSolAmount);

        if (checkForBuyResult.canBuy) {
            log(`autoBuy 📢 => Recommandation d'achat => ${checkForBuyResult.amount} SOL (${checkForBuyResult.reason})`);

            if (this.pumpfunWebsocketApiSubscriptions) {
                this.pumpfunWebsocketApiSubscriptions.unsubscribeNewTokens();

                this.pumpfunWebsocketApiSubscriptions.subscribeToTokens([mintMessage.mint]);

            } else {
                warn(`${now()} autoBuy ⚠️ => Souscriptions websocket non disponibles => Achat annulé`);
                return;
            }


            this.status = 'buying';
            this.currentToken = { tokenAddress: mintMessage.mint, mintMessage, tradesMessages: [], holders: new Map };
            this.tokenInfos = tokenInfos;

            const buySolAmount = checkForBuyResult.amount; // TODO: Math.min(balanceSol, checkForBuyResult.amount)

            if (this.settings?.minSolInWallet && buySolAmount > maxSolAmount) {
                warn(`${now()} autoBuy ⚠️ => Montant demandé (${buySolAmount}) supérieur à la somme disponible (${maxSolAmount}) => Achat refusé`);
                return;
            }

            if (this.settings?.minBuyAmount && buySolAmount < this.settings.minBuyAmount) {
                warn(`${now()} autoBuy ⚠️ => Montant demandé (${buySolAmount}) inférieur au minimum autorisé (${this.settings.minBuyAmount}) => Achat annulé`);
                return;
            }


            this.buyToken(tokenInfos, buySolAmount)
                .then(() => {
                    // surveiller les opportunités de vente
                    this.watchForSell(tokenInfos);
                })
                .catch((err: any) => {
                    warn(`${now()} ❌ Achat échoué. ${err.message}`);

                    this.setStatus('idle');
                    //this.status = 'idle';
                    //this.currentToken = null;
                    //this.currentPosition = null;
                    //this.currentKpis = null;

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
            warn(`${now()} autoSell ⚠️ => Invalide statut ${this.status} => Vente annulée`);
            return;
        }

        if (!this.currentToken) {
            warn(`${now()} autoSell ⚠️ => Aucun token en position => Vente annulée`);
            return;
        }

        if (!this.currentPosition) {
            warn(`${now()} autoSell ⚠️ => Aucune position ouverte => Vente annulée`);
            return;
        }

        if (tokenInfos.tokenAddress !== this.currentToken.tokenAddress) {
            warn(`${now()} autoSell ⚠️ => Trade du token ${tokenInfos.tokenAddress} inattendu. (token actif = ${this.currentToken.tokenAddress}) => Vente annulée`);
            return;
        }


        const checkForSellResult = await this.evaluateTokenForSell(this.currentToken, this.currentPosition, tokenInfos);

        if (checkForSellResult.canSell) {
            log(); // pour cloturer la ligne dynamique
            log(`autoSell => 📢 Recommandation de vente => ${checkForSellResult.amount} ${tokenInfos.tokenSymbol} (${checkForSellResult.reason})`);

            this.status = 'selling';
            const sellTokenAmount = checkForSellResult.amount;

            this.sellToken(tokenInfos.tokenAddress, sellTokenAmount)
                .then(() => {
                    // Ré-écouter les mint de tokens
                    this.startListeningForTokensMint();
                })
                .catch((err: any) => {
                    warn(`${now()} ❌ Vente échouée. ${err.message}`);

                    this.status = 'delaying';
                    setTimeout(() => this.status = 'wait_for_sell', 5_000);
                })
        }
    }


    private watchForSell(tokenInfos: PumpTokenInfo) {

        if (this.status !== 'hold') {
            warn(`${now()} watchForSell ⚠️ => Etat "${this.status}" inattendu. Etat "hold" requis. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentToken) {
            warn(`${now()} watchForSell ⚠️ => Aucun token en position. Surveillance des ventes abandonnée`);
            return;
        }

        if (tokenInfos.tokenAddress !== this.currentToken.tokenAddress) {
            warn(`${now()} watchForSell ⚠️ => Token inattendu. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentPosition) {
            warn(`${now()} watchForSell ⚠️ => Aucune position ouverte. Surveillance des ventes abandonnée`);
            return;
        }


        log(`Mise en attente d'opportunité de vente du token ${this.currentToken.tokenAddress}`);

        this.status = 'wait_for_sell';


        const mintDate = tokenInfos.createdAt;
        //const myBuy = this.currentToken.tradesMessages.find(trade => trade.txType === 'buy' && trade.traderPublicKey === this.wallet.publicKey.toBase58());
        const buyDate = this.currentPosition.timestamp;

        let lastLogTime = 0;
        //let firstPrice: null | string = null;
        const watchedTokenAddress = this.currentToken.tokenAddress;


        const logIntervalId = setInterval(() => {
            if (watchedTokenAddress !== this.currentToken?.tokenAddress || ! this.currentPosition || this.status !== 'wait_for_sell') {
                //warn(`${now()} watchForSell ⚠️ => Changement du contexte. Surveillance des ventes stoppée`);
                clearInterval(logIntervalId);
                return;
            }

            if (! this.currentKpis) {
                warn(`${now()} watchForSell ⚠️ => Pas de KPI trouvé pour le token. Surveillance des ventes dégradée`);
                return;
            }

            if (Date.now() - lastLogTime < 1000) return; // Limiter l'affichage à 1 refresh par seconde
            lastLogTime = Date.now();


            /*
            //const lastTrade = this.currentToken?.tradesMessages[this.currentToken.tradesMessages.length - 1];
            //const currentPrice = currentPosition?.tradesMessages[currentPosition.tradesMessages.length - 1]?.price || '0';
            //const currentPrice = lastTrade ? (lastTrade.vSolInBondingCurve / lastTrade.vTokensInBondingCurve).toFixed(10) : '0.0';
            const currentPrice = tokenInfos.price;
            //firstPrice = firstPrice ?? currentPrice;

            const buyPrice = this.currentPosition?.buyPrice || currentPrice.toString();
            const tokenAmount = this.currentPosition?.tokenAmount || 0;
            const profit = 100 * (Number(currentPrice) / Number(buyPrice));


            //const lastActivityAge = this.currentToken?.tradesMessages.length
            //    ? Math.round((Date.now() - mintDate.getTime()) / 1000)
            //    : 0;
            */

            const inactivityAge = ((Date.now() - tokenInfos.lastUpdated.getTime()) / 1000).toFixed(1);
            const mintAge = ((Date.now() - mintDate.getTime()) / 1000).toFixed(1);
            const buyAge = ((Date.now() - buyDate.getTime()) / 1000).toFixed(1);
            const positionAge = ((Date.now() - this.currentPosition.timestamp.getTime()) / 1000).toFixed(1);

            const volumeSol = this.currentToken?.tradesMessages.map(trade => trade.solAmount).reduce((p,c) => p + c, 0);

            const { buyPrice, tokenAmount, currentPrice, profit } = this.currentKpis;

            const infosLine1 = [
                `${formatAddress(watchedTokenAddress)}`,
                `Buy: ${buyPrice} SOL`,
                `Prix: ${currentPrice} SOL`,
                //`Qté: ${tokenAmount.toFixed(0)}`,
                `Age: ${mintAge} s.`,
                `BuyAge: ${buyAge} s.`,
                `PosAge: ${positionAge} s.`,
                `Inact.: ${inactivityAge} s.`,
                `Holders: ${this.currentToken.holders.size}`,
                `Trades: ${this.currentToken?.tradesMessages.length || 0}`,
                `Vol: ${volumeSol.toFixed(3)} SOL`,
                //`Dev: -1 SOL (-1%)`,
            ];

            const infosLine2 = [
                `Profit: ${profit.toFixed(2)}%`,
                `ratio_3: ${this.currentKpis.lastTrades3BuyPercent.toFixed(1)}%`,
                `ratio_5: ${this.currentKpis.lastTrades5BuyPercent.toFixed(1)}%`,
                `min: ${this.currentKpis.minPrice.toFixed(10)}%`,
                `max: ${this.currentKpis.maxPrice.toFixed(10)}%`,
                `percentOfAth: ${this.currentKpis.percentOfAth.toFixed(1)}`,
                `weightedScore: ${JSON.stringify(this.currentKpis.weightedScore)}`,
                `finalScore: ${this.currentKpis.finalScore}`,
            ];

            // afficher un message dynamique sur la console : buyPrice | buyMarketCap | currentPrice | currentMarketCap | trades | holders | gain | gainVsMaxGain | mintAge | buyAge | lastActivityAge

            //process.stdout.write(`\r$${infosLine1.join(' | ')}`);

            // Efface les lignes précédentes et positionne le curseur
            process.stdout.write('\r\x1b[K'); // Efface la ligne actuelle
            process.stdout.write(`${infosLine1.join(' | ')}`);
            process.stdout.write('\n\r\x1b[K'); // Nouvelle ligne et efface
            process.stdout.write(`${infosLine2.join(' | ')}`);
            // Remonte le curseur d'une ligne pour que la prochaine écriture commence au bon endroit
            process.stdout.write('\x1b[1A\r');


            // vérifier si opportunité de vente
            this.autoSell(tokenInfos);

        }, 1000);


        if (! this.currentKpis) {
            this.autoSell(tokenInfos);
        }
    }



    private async buyToken(tokenInfos: PumpTokenInfo, solAmount: number) {
        if (this.status !== 'buying') {
            warn(`${now()} buyToken ⚠️ => Processus d'achat non initié`);
            return;
        }

        if (!this.currentToken) {
            warn(`${now()} buyToken ⚠️ => Aucun token actif => Achat annulé`);
            return;
        }

        if (tokenInfos.tokenAddress !== this.currentToken.tokenAddress) {
            warn(`${now()} buyToken ⚠️ => Achat sur le mauvais token => Achat annulé`);
            return;
        }

        if (this.currentPosition) {
            warn(`${now()} buyToken ⚠️ => Une position est déjà ouverte => Achat annulé`);
            return;
        }

        if (!this.connection) {
            warn(`${now()} buyToken ⚠️ => Aucune connexion solana/web3 ouverte => Achat annulé`);
            return;
        }


        log()
        log('#'.repeat(100))
        log(padCenter(`process d'achat initié ⏳ => token ${tokenInfos.tokenAddress}`, 100))
        log('#'.repeat(100))
        log()


        log(`Achat en cours du token ${this.currentToken.tokenAddress} Step 1/3`);


        // 1) créer transaction buy
        const tx = await buildPortalBuyTransaction(this.wallet.publicKey, this.currentToken.tokenAddress, solAmount, this.slippage, this.priorityFee);
        //log('buy tx:', tx);

        log(`Achat en cours du token ${this.currentToken.tokenAddress} Step 2/3`);


        // 2) envoyer transaction buy
        const txResult: TransactionResult = await sendSolanaTransaction(this.connection, this.wallet, tx);

        // test
        //const txResult: TransactionResult = { success: true, signature: '37TptP3nTLXMrm5QshwRdUZnh3eWi2U99KiifUm3dAzhCNKyxjAG62kYM6Gw7RXPkq2JJvGRNbFroJuZG98WDHUN' }; // DEBUG


        if (!txResult.success || !txResult.signature) {

            if (true) {
                warn(`${now()} Erreur pendant l'achat`);

                if (txResult.error) {
                    warn(`${now()}  - message: ${txResult.error.transactionMessage}`);

                    txResult.error.transactionLogs.forEach(log => {
                        warn(`${now()}  - log: ${log}`);
                    })

                    //log('ERR', txResult.error.transactionError)
                }
            }

            throw new Error(`Erreur pendant l'achat. ${txResult.error?.transactionMessage ?? txResult.error?.message ?? ''}`);
        }

        log(`Attente Transaction: https://solscan.io/tx/` + txResult.signature);


        // 3) attendre et récupérer transaction buy
        const txResponseResult = txResult.results ?? await getTransaction(this.connection, txResult.signature);

        log(`✅ Transaction d'achat récupérée`);


        // 4) Décoder la transaction et récupérer les nouveaux soldes (SOL et tokens)
        if (!txResponseResult) throw new Error(`Erreur de décodage de la transaction d'achat`);
        const pumpResult = parsePumpTransaction(txResponseResult) as TradeInfo;

        log(`✅ Transaction d'achat décodée => prix d'achat = ${pumpResult.price} SOL`);

        //log(`Détails pour analyse du prix d'achat :`, pumpResult)

        // Mise à jour des balances
        const checkedTokenBalance = { amount: pumpResult.traderPostBalanceToken, lastUpdated: pumpResult.timestamp };
        //log(`buyToken 📢 => Balance Token mise à jour : ${checkedTokenBalance.amount.toFixed(9)} ${tokenInfos.tokenSymbol}`);

        const preBalance = pumpResult.traderPreBalanceSol;
        this.solBalance = { amount: pumpResult.traderPostBalanceSol, lastUpdated: pumpResult.timestamp };
        //log(`buyToken 📢 => Balance Sol mise à jour : ${this.solBalance.amount.toFixed(9)} SOL`);

        log(`buyToken 📢 => Balances UPDATED => ${this.solBalance.amount.toFixed(9)} SOL | ${checkedTokenBalance.amount.toFixed(9)} ${tokenInfos.tokenSymbol}`);


        // Création de la position
        this.currentPosition = {
            tokenAddress: this.currentToken.tokenAddress,
            preBalance,
            postBalance: null,
            recommandedSolAmount: solAmount,
            buyPrice: pumpResult.price,
            buySolAmount: pumpResult.solAmount,
            tokenAmount: pumpResult.tokenAmount,
            checkedBalance: checkedTokenBalance,
            profit: null,
            timestamp: new Date((txResponseResult.blockTime ?? Date.now()/1000) * 1000),
        }

        this.status = 'hold';

        log(`Achat en cours du token ${this.currentToken.tokenAddress} Step 3/3`);

        log()
        log('#'.repeat(100))
        log(padCenter(`process d'achat terminé ✅ => token ${this.currentToken.tokenAddress}`, 100))
        log('#'.repeat(100))
        log()
        log(`👉 https://pump.fun/coin/${this.currentToken.tokenAddress}`);
        log()

    }


    private async sellToken(tokenAddress: string, tokenAmount: number) {
        if (this.status !== 'selling') {
            warn(`${now()} sellToken ⚠️ => Processus de vente non initié`);
            return;
        }

        if (!this.currentToken) {
            warn(`${now()} sellToken ⚠️ => Aucun token actif => Vente annulée`);
            return;
        }

        if (tokenAddress !== this.currentToken.tokenAddress) {
            warn(`${now()} sellToken ⚠️ => Vente du mauvais token => Vente annulée`);
            return;
        }

        if (!this.currentPosition) {
            warn(`${now()} sellToken ⚠️ => Aucune position ouverte => Vente annulée`);
            return;
        }

        if (!this.connection) {
            warn(`${now()} sellToken ⚠️ => Aucune connexion solana/web3 ouverte => Vente annulée`);
            return;
        }


        log();
        log('#'.repeat(100))
        log(padCenter(`process de vente initié ⏳ => token ${tokenAddress}`, 100))
        log('#'.repeat(100))
        log()


        log(`Vente en cours du token ${tokenAddress} Step 1/3`);

        // TODO

        // 1) créer transaction sell
        const tx = await buildPortalSellTransaction(this.wallet.publicKey, tokenAddress, tokenAmount, this.slippage, this.priorityFee);
        //log('sell tx:', tx);

        log(`Vente en cours du token ${tokenAddress} Step 2/3`);


        // 2) envoyer transaction sell
        const txResult: TransactionResult = await sendSolanaTransaction(this.connection, this.wallet, tx);

        // test
        //const txResult: TransactionResult = { success: true, signature: '5jpctgtMZuHEMtbD7VdB5MMzJwCnWgM7191M7zpr4RxehP6mNHeYDRYwswEWUxyukZqvSi2TTYn24TiNVFm2PYUH' }; // DEBUG


        if (!txResult.success || !txResult.signature) {

            if (true) {
                warn(`${now()} Erreur pendant la vente`);

                if (txResult.error) {
                    warn(`${now()}  - message: ${txResult.error.transactionMessage}`);

                    txResult.error.transactionLogs.forEach(log => {
                        warn(`${now()}  - log: ${log}`);
                    })

                    //log('ERR', txResult.error.transactionError)
                }
            }

            throw new Error(`Erreur pendant la vente. ${txResult.error?.transactionMessage ?? txResult.error?.message ?? ''}`);
        }

        log(`Attente Transaction: https://solscan.io/tx/` + txResult.signature);


        // 3) attendre et récupérer transaction sell
        const txResponseResult = txResult.results ?? await getTransaction(this.connection, txResult.signature);

        log(`✅ Transaction de vente récupérée`);


        // 4) Décoder la transaction et récupérer les nouveaux soldes (SOL et tokens)
        if (!txResponseResult) throw new Error(`Erreur de décodage de la transaction de vente`);
        const pumpResult = parsePumpTransaction(txResponseResult) as TradeInfo;

        log(`✅ Transaction de vente décodée => prix de vente = ${pumpResult.price} SOL`);

        //log(`Détails pour analyse du prix de vente :`, pumpResult)


        // Mise à jour des balances
        const checkedTokenBalance = { amount: pumpResult.traderPostBalanceToken, lastUpdated: pumpResult.timestamp };
        //log(`sellToken 📢 => Balance Token mise à jour : ${checkedTokenBalance.amount.toFixed(9)} ${this.currentToken.mintMessage.symbol}`);

        this.solBalance = { amount: pumpResult.traderPostBalanceSol, lastUpdated: pumpResult.timestamp };
        //log(`sellToken 📢 => Balance Sol mise à jour : ${this.solBalance.amount.toFixed(9)} SOL`);

        log(`sellToken 📢 => Balances UPDATED => ${this.solBalance.amount.toFixed(9)} SOL | ${checkedTokenBalance.amount.toFixed(9)} ${this.currentToken.mintMessage.symbol}`);



        // Mise à jour de la position
        const positionUpdate: Partial<Position> = {
            sellPrice: pumpResult.price,
            sellSolAmount: pumpResult.solAmount,
            tokenAmount: pumpResult.tokenAmount,
            postBalance: this.solBalance?.amount,
            profit: 100 * (Number(pumpResult.price) - Number(this.currentPosition.buyPrice)) / Number(this.currentPosition.buyPrice),
        }

        Object.assign(this.currentPosition, positionUpdate);


        if (checkedTokenBalance.amount !== 0) {
            warn(`${now()} ⚠️ Solde de tokens non nul après la vente. Process stoppé pour analyse.`);

            if (checkedTokenBalance.amount >= 1) {
                warn(`${now()} ⚠️ Process stoppé pour analyse.`);
                process.exit();
            }
        }

        // Historise la position
        positionsHistory.push(this.currentPosition);


        // Mise à jour des souscriptions websocket
        if (this.pumpfunWebsocketApiSubscriptions) {
            this.pumpfunWebsocketApiSubscriptions.unsubscribeToTokens([tokenAddress]);
        }


        log(`Vente en cours du token ${tokenAddress} Step 3/3`);
        log(`👉 Gain = ${((this.currentPosition.postBalance ?? 0) - this.currentPosition.preBalance).toFixed(3)} SOL`);


        this.setStatus('idle');
        //this.status = 'idle';
        //this.currentToken = null;
        //this.currentPosition = null;
        //this.currentKpis = null;

        log()
        log('#'.repeat(100))
        log(padCenter(`process de vente terminé ✅ => token ${tokenAddress}`, 100))
        log('#'.repeat(100))
        log()
        log(); log()
        log('~'.repeat(100))
        log(); log()

    }


    private setStatus(newStatus: Status) {
        if (newStatus === 'idle') {
            asserts(['buying', 'selling', 'hold', 'wait_for_sell'].includes(this.status), `Impossible de passer de l'état "${this.status}" à l'état "idle"`);
            this.status = 'idle';
            this.currentToken = null;
            this.currentPosition = null;
            this.currentKpis = null;

        } else if (newStatus === 'wait_for_buy') {
            asserts(['idle'].includes(this.status), `Impossible de passer de l'état "${this.status}" à l'état "wait_for_buy"`);

        } else if (newStatus === 'buying') {
            asserts(['wait_for_buy'].includes(this.status), `Impossible de passer de l'état "${this.status}" à l'état "buying"`);

        } else if (newStatus === 'hold') {
            asserts(['buying'].includes(this.status), `Impossible de passer de l'état "${this.status}" à l'état "hold"`);

        } else if (newStatus === 'wait_for_sell') {
            asserts(['hold'].includes(this.status), `Impossible de passer de l'état "${this.status}" à l'état "wait_for_sell"`);

        } else if (newStatus === 'selling') {
            asserts(['wait_for_sell'].includes(this.status), `Impossible de passer de l'état "${this.status}" à l'état "selling"`);

        } else if (newStatus === 'delaying') {
            asserts(['buying', 'selling'].includes(this.status), `Impossible de passer de l'état "${this.status}" à l'état "delaying"`);

        }
    }


    private async evaluateTokenForBuy(mintMessage: WsCreateTokenResult, tokenInfos: PumpTokenInfo, maxSolAmount: number): Promise<{ canBuy: boolean, amount: number, reason: string }> {
        if (!mintMessage) return { canBuy: false, amount: 0, reason: `Message de mint manquant` };
        if (!tokenInfos) return { canBuy: false, amount: 0, reason: `Infos du token manquantes` };

        const tokenAge = (Date.now() - tokenInfos.createdAt.getTime()) / 1000;
        //log(`👉 Age du token: ${tokenAge.toFixed(1)} sec.`);
        //log();

        const devBuySolAmount = tokenInfos.initialBuy?.solAmount ?? 0;
        const devBuyTokenAmount = tokenInfos.initialBuy?.tokenAmount ?? 0;
        const devBuyTokenPercentage = tokenInfos.initialBuy?.traderPostPercentToken ?? 0;

        // vérifie si les conditions d'achat sont remplies (age du mint, solAmount du dev, percentage du dev, nom & symbol, ...)

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

        let buyTokenPercentageScore = devBuyTokenPercentage <= 1
            ? 80
            : devBuyTokenPercentage <= 2
                ? 60
                : devBuyTokenPercentage <= 5
                    ? 40
                    : 20;


        // Calculer le score global avec pondérations
        const weightedScore = [
            [Math.round(ageScore), 40],
            [Math.round(buySolScore), 30],
            [Math.round(buyTokenPercentageScore), 30],
        ];

        // Arrondir le score
        const weightTotals = weightedScore.reduce((p, c) => p + c[1], 0);
        const scoreTotals = weightedScore.reduce((p, c) => p + c[0] * c[1], 0);
        const finalScore = Math.round(scoreTotals / weightTotals);

        //log(`evaluateTokenForBuy => weightedScore:`, weightedScore, '=>', finalScore)

        if (true) {
            const infosLine1 = [
                //`${formatAddress(mintMessage.mint)}`,
                mintMessage.mint,
                `Age: ${tokenAge} s.`,
                `Dev: ${devBuySolAmount.toFixed(3)} SOL (${devBuyTokenPercentage.toFixed(2)} %)`,
                `weightedScore: ${JSON.stringify(weightedScore)}`,
                `finalScore: ${finalScore}`,
            ];

            log(`${infosLine1.join(' | ')}`);
        }


        const scoreNormalized = 100 * (finalScore - (this.settings?.scoreMinForBuy ?? 60)) / (100 - (this.settings?.scoreMinForBuy ?? 60));

        if (finalScore >= (this.settings?.scoreMinForBuy ?? 60)) {
            const buyDefaultAmount = this.settings?.defaultBuyAmount ?? 0.01;
            const buyMinAmount = Math.max(buyDefaultAmount * 0.5, this.settings?.minBuyAmount ?? buyDefaultAmount * 0.5);
            const buyMaxAmount = Math.min(maxSolAmount, buyDefaultAmount * 1.5, this.settings?.maxBuyAmount ?? buyDefaultAmount * 1.5);
            const buyAmountRange = buyMaxAmount - buyMinAmount;
            const solAmount = buyMinAmount + scoreNormalized * buyAmountRange / 100;

            if (buyMaxAmount <= buyMinAmount || solAmount <= 0) {
                warn(`${now()} evaluateTokenForBuy ⚠️ => Balance SOL insuffisante`);
                return { canBuy: false, amount: 0, reason: `Balance SOL insuffisante` }
            }

            return { canBuy: true, amount: solAmount, reason: `Score d'achat - ${finalScore}/100 - satisfaisant` }

        } else {
            return { canBuy: false, amount: 0, reason: `Conditions d'achat non satisfaites` }
        }
    }



    private async evaluateTokenForSell(selectedToken: SelectedToken, position: Position, tokenInfos: PumpTokenInfo): Promise<{ canSell: boolean, amount: number, reason: string }> {
        if (!tokenInfos) return { canSell: false, amount: 0, reason: `Infos du token manquantes` };
        if (!this.currentPosition) return { canSell: false, amount: 0, reason: `Infos de la position manquantes` };

        // vérifie si les conditions de ventes sont remplies (age, activité/inactivité, nb trades, nb holders, ventes massives, ... )

        const lastTrades100 = selectedToken.tradesMessages.slice(-100);

        const lastTrades3 = lastTrades100.slice(-3);
        const lastTrades3Buy = lastTrades3.filter(trade => trade.txType === 'buy').length;
        const lastTrades3Sell = lastTrades3.length - lastTrades3Buy;
        const lastTrades3BuyPercent = lastTrades3.length > 1 ? (75 - (100 * lastTrades3Buy / lastTrades3.length) / 2) : 50; // score normalisé entre 25% et 75%

        const lastTrades5 = lastTrades100.slice(-5);
        const lastTrades5Buy = lastTrades5.filter(trade => trade.txType === 'buy').length;
        const lastTrades5Sell = lastTrades5.length - lastTrades5Buy;
        const lastTrades5BuyPercent = lastTrades5.length > 1 ? (75 - (100 * lastTrades5Buy / lastTrades5.length) / 2) : 50; // score normalisé entre 25% et 75%

        const buyPrice = Number(position.buyPrice);
        const minPrice = Math.min(...lastTrades100.map(trade => trade.vSolInBondingCurve / trade.vTokensInBondingCurve));
        const maxPrice = Math.max(...lastTrades100.map(trade => trade.vSolInBondingCurve / trade.vTokensInBondingCurve));

        const priceOffset = maxPrice - buyPrice;
        const currentPrice = Number(tokenInfos.price);
        const percentOfAth = (priceOffset && lastTrades100.length > 0) ? (100 * (currentPrice - buyPrice) / Math.abs(priceOffset)) : 50;
        const profit = 100 * (currentPrice - buyPrice) / buyPrice;

        const tokenAge = (Date.now() - tokenInfos.createdAt?.getTime()) / 1000;
        const inactivityAge = (Date.now() - tokenInfos.lastUpdated?.getTime()) / 1000;
        const positionAge = (Date.now() - this.currentPosition.timestamp.getTime()) / 1000;


        // plus le percentOfAth est petit plus on a de raison de vendre (si percentOfAth < 0 on vend à perte)
        const sellScore = isNaN(percentOfAth)
            ? 50
            : percentOfAth < 0
                ? 90
                : percentOfAth > 0 && percentOfAth < 40
                    ? 80
                    : percentOfAth > 0 && percentOfAth < 60
                        ? 70
                        : percentOfAth > 0 && percentOfAth < 80
                            ? 40
                            : 20

        // plus le inactivityAge est grand plus on a de raison de vendre
        const inactivityScore = inactivityAge >= 30
            ? 75
            : inactivityAge >= 10
                ? 60
                : inactivityAge >= 5
                    ? 50
                    : inactivityAge >= 3
                        ? 40
                        : 30;

        // plus le tokenAge est grand plus on a de raison de vendre (peut etre inutile car moins pertinent que inactivityAge ?)
        const ageScore = tokenAge >= 120
            ? 70
            : tokenAge >= 60
                ? 60
                : tokenAge >= 30
                    ? 50
                    : tokenAge >= 10
                        ? 40
                        : 30;

        const weightedScore = [
            [Math.round(sellScore), 30],
            [Math.round(ageScore), 10],
            [Math.round(inactivityScore), 30],
            [Math.round(lastTrades3BuyPercent), 30],
            [Math.round(lastTrades5BuyPercent), 20],
        ];

        // Arrondir le score
        const weightTotals = weightedScore.reduce((p, c) => p + c[1], 0);
        const scoreTotals = weightedScore.reduce((p, c) => p + c[0] * c[1], 0);
        const finalScore = Math.round(scoreTotals / weightTotals);

        let tokenAmount = position.tokenAmount;


        this.currentKpis = {
            buyPrice: position.buyPrice,
            tokenAmount,
            currentPrice: currentPrice.toFixed(10),
            profit,
            mintAge: tokenAge,
            weightedScore,
            finalScore,
            percentOfAth,
            lastTrades3BuyPercent,
            lastTrades5BuyPercent,
            minPrice,
            maxPrice,
        }



        if (position.tokenAmount <= 0) {
            warn(`${now()} evaluateTokenForSell ⚠️ => Balance Token insuffisante`);
            return { canSell: false, amount: 0, reason: `Balance Token insuffisante` }
        }


        if (finalScore >= (this.settings?.scoreMinForSell ?? 60)) {
            return { canSell: true, amount: tokenAmount, reason: `Score de ventes - ${finalScore}/100 - satisfaisant` } // TODO: a decouper en (vente gagnante) et (vente perdante)

        } else if (profit < -(this.settings?.stopLimit ?? 20)) {
            return { canSell: true, amount: tokenAmount, reason: `Stop Limit @ ${profit.toFixed(1)}% profit` };

        } else if (profit > (this.settings?.takeProfit ?? 100)) {
            return { canSell: true, amount: tokenAmount, reason: `Take Profit @ ${profit.toFixed(1)}% profit` }

        } else if (positionAge > 10 && lastTrades100.length >= 15 && percentOfAth > 0 && percentOfAth < (this.settings?.trailingStop ?? 80)) {
            return { canSell: true, amount: tokenAmount, reason: `Trailing Stop @ ${profit.toFixed(1)}% profit & ${percentOfAth}% of ATH` }

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
        log(`📢 Inscrit aux nouveaux tokens`);
    }


    unsubscribeNewTokens() {
        pumpWsApi.unsubscribeNewToken(this.ws);
        log(`📢 Désinscrit des nouveaux tokens`);
    }


    subscribeToTokens(tokenAddresses: string[]) {
        pumpWsApi.subscribeTokenTrade(this.ws, tokenAddresses);
        log(`📢 Inscrit aux tokens ${tokenAddresses.join(' | ')}`);
    }


    unsubscribeToTokens(tokenAddresses: string[]) {
        pumpWsApi.unsubscribeTokenTrade(this.ws, tokenAddresses);
        log(`📢 Désinscrit des tokens ${tokenAddresses.join(' | ')}`);
    }

}




function handleSolanaCreateTokenMessage(ws: WebSocket, mintInput: FastListenerCreateTokenInput) {
    //log('FL/mintInput:', mintInput);

    if (!fastListenerMints.has(mintInput.hash)) {
        fastListenerMints.set(mintInput.hash, mintInput);
        log(`==> SET MINT TX for token ${mintInput.accounts.mint}`);
    }
}


function handleSolanaTradeTokenMessage(ws: WebSocket, tradeInput: FastListenerTradeInput) {
    //log('FL/tradeInput:', tradeInput);

    if (!fastListenerTrades.has(tradeInput.hash)) {
        fastListenerTrades.set(tradeInput.hash, tradeInput);
    }
}



async function retrieveTransactionWithRpc(connection: Connection | null, signature: string): Promise<VersionedTransactionResponse | null> {
    if (!connection) return null;

    const promise = () => connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0
    });

    //const onRetry = (attempt: number, elapsedMs: number, retryIntervalMs: number) => log(`retrieveTransactionWithRpc => ⚠️ Echec de la tentative ${attempt}. Temps total écoulé ${elapsedMs} ms. Nouvelle tentative dans ${retryIntervalMs} ms`);
    const onRetry = (attempt: number, elapsedMs: number, retryIntervalMs: number) => void (0);

    const resultChecker = (result: any) => result !== null;

    const transaction: VersionedTransactionResponse | null = await retryAsync(promise, 200, 2_000, onRetry, resultChecker)
        .catch((err: any) => {
            return retryAsync(promise, 1000, 20_000, onRetry, resultChecker)
        })

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

        //warn(`${now()} Transaction ${signature} non trouvée dans les ${fastListenerMints.size} transactions de FastListener.`);

        await sleep(50);
    }

    return mintInput ?? null;
}


function log(...args: any[]) {
    args.unshift(...[now(), '|']);
    console.log(...args)
}

function warn(...args: any[]) {
    args.unshift(...[now(), '|']);
    console.warn(...args)
}

function error(...args: any[]) {
    args.unshift(...[now(), '|']);
    console.error(...args)
}


function now(date?: Date) {
    return getTime(date);
    //return (date ?? new Date).toLocaleTimeString('fr-FR', { timeStyle: 'medium', second: 'numeric' });
    //return (date ?? new Date).toISOString()
    //    .replace('Z', '')
    //    .replace('T', ' ');
}





/* ######################################################### */


// Démarrer le programme
main().catch((err: any) => {
    error('Erreur fatale:', err);
    process.exit(1);
});


