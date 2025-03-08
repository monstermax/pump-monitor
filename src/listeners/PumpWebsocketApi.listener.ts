// PumpWebsocketApi.listener.ts

import WebSocket from 'ws';
import EventEmitter from 'events';

import { appConfig } from '../env';
import { CreateTokenTxResult, TokenTradeTxResult } from '../services/PumpListener.service';
import * as pumpWsApi from '../lib/pumpfun/pumpfun_websocket_api';
import { ServiceAbstract } from '../services/abstract.service';
import { ServiceManager } from '../managers/Service.manager';


/* ######################################################### */

// Api: https://pumpportal.fun/data-api/real-time

// websocket tester : https://ws-playground.netlify.app/


/* ######################################################### */


export type WsPumpMessage = WsSubscribeResult | WsUnsubscribeResult | WsCreateTokenResult | WsTokenTradeResult;

export type WsSubscribeResult = { message: string };

export type WsUnsubscribeResult = { message: string };


export type WsCreateTokenResult = {
    signature: string
    mint: string
    traderPublicKey: string
    txType: 'create'
    initialBuy: number
    solAmount: number
    bondingCurveKey: string
    vTokensInBondingCurve: number
    vSolInBondingCurve: number
    marketCapSol: number
    name: string
    symbol: string
    uri: string
    pool: string
}


export type WsTokenTradeResult = {
    signature: string
    mint: string
    traderPublicKey: string
    txType: 'sell' | 'buy'
    tokenAmount: number
    solAmount: number
    newTokenBalance: number
    bondingCurveKey: string
    vTokensInBondingCurve: number
    vSolInBondingCurve: number
    marketCapSol: number
    pool: string
}


/* ######################################################### */


export class PumpWebsocketApi extends ServiceAbstract {
    private ws: WebSocket | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private isConnected: boolean = false;
    private tokensSubscriptions = new Set();


    constructor(serviceManager: ServiceManager) {
        super(serviceManager);
    }


    start() {
        if (this.status !== 'stopped') return;

        super.start();
        this.connect();
        super.started();
    }


    stop() {
        if (this.status !== 'started') return;

        super.stop();

        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
        }

        super.stopped();
    }


    /** Connexion au websocket Pump.fun (API) */
    private connect() {
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
        }

        this.ws = new WebSocket(appConfig.websocketApi.url);

        this.ws.on('open', () => {
            this.success('Connected to PumpFun API WebSocket (PumpWebsocketApi)');

            this.isConnected = true;
            this.setupPing();

            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = null;
            }

            // Souscription aux evenements "NewToken"
            this.subscribeNewTokens();
        });

        // Gestion des evenements websocket
        this.ws.on('message', this.handleMessage.bind(this));
        this.ws.on('close', this.handleClose.bind(this));
        this.ws.on('error', this.handleError.bind(this));

        //database.on('tokenDeleted', (tokenAddress: string) => {
        //    if (this.tokensSubscriptions.has(tokenAddress)) {
        //        this.unsubscribeToTokens([tokenAddress]);
        //        this.tokensSubscriptions.delete(tokenAddress);
        //    }
        //})
    }


    /** Met en place la gestion du ping/pong pour maintenir la connexion websocket */
    private setupPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }

        this.pingInterval = setInterval(() => {
            if (this.ws && this.isConnected) {
                this.ws.ping();
            }
        }, appConfig.websocketApi.pingInterval);
    }


    /** Gère la réception d'un message sur le websocket */
    private handleMessage(data: WebSocket.Data) {
        //console.log('WebSocketClient.handleMessage');

        try {
            const message: WsPumpMessage = JSON.parse(data.toString());

            if ('txType' in message) {

                if (message.txType === 'buy' || message.txType === 'sell') {
                    // message TRADE (buy or sell)

                    const tradeMessage: TokenTradeTxResult = {
                        ...message,
                        dataSource: 'PumpWebsocketApi'
                    };

                    // Emet à evenement à destination de PumpMonitor
                    this.emit('trade', tradeMessage);

                    // Souscription aux trades du trader initial (pour analyser les wallets. non implémenté)
                    //this.subscribeToTraders([message.traderPublicKey]); // Désactivé pour le moment. A implémenter quand on fera la detection de whales

                } else if (message.txType === 'create') {
                    // message MINT (create)

                    const createMessage: CreateTokenTxResult = {
                        ...message,
                        totalSupply: message.initialBuy + message.vTokensInBondingCurve,
                        signature: message.signature,
                        image: '', // extrait plus tard (en asynchrone) via fetch uri
                        dataSource: 'PumpWebsocketApi',
                    };

                    // Emet à evenement 'create' à destination de PumpMonitor
                    //this.emit('create', createMessage);

                    if (message.initialBuy > 0) {
                        // Emet à evenement 'trade' à destination de PumpMonitor (pour le devBuy)
                        const tradeMessage: TokenTradeTxResult = {
                            ...message,
                            txType: 'buy',
                            tokenAmount: message.initialBuy,
                            dataSource: 'PumpWebsocketApi'
                        };

                        //this.emit('trade', tradeMessage);
                        this.emit('create', createMessage, tradeMessage);

                    } else {
                        this.emit('create', createMessage);
                    }

                    // Unsubscribe NewTokens events (TEST / DEBUG)
                    //this.unsubscribeToNewTokens();

                    // Souscription aux trades du token
                    this.subscribeToTokens([message.mint]);
                    this.tokensSubscriptions.add(message.mint);

                    // Souscription aux trades du trader initial
                    //this.subscribeToTraders([message.traderPublicKey]); // Désactivé pour le moment. A implémenter quand on fera la detection de whales
                }

            }

        } catch (err: any) {
            this.error(`Erreur parsing message: ${err.message}`);
        }
    }


    /** Gère la fermeture annoncée de la connexion websocket */
    private handleClose() {
        this.log('WebSocket closed');
        this.cleanup();

        if (this.status === 'started') {
            this.scheduleReconnect();
        }
    }


    /** Gère les erreurs survenues sur la connexion websocket */
    private handleError(err: Error) {
        this.error(`WebSocket error: ${err.message}`);
        this.cleanup();

        if (this.status === 'started') {
            this.scheduleReconnect();
        }
    }


    /** Nettoyage des timeouts/intervals après déconnexion */
    private cleanup() {
        this.isConnected = false;

        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }


    /** Programme une reconnexion au websocket dans 5 secondes */
    private scheduleReconnect() {
        if (!this.reconnectTimeout) {
            this.reconnectTimeout = setTimeout(() => {
                this.log('Tentative de reconnexion...');
                this.connect();
            }, 5000); // Reconnexion après 5 secondes
        }
    }


    /** Ferme la connexion au websocket */
    public close() {
        this.cleanup();
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }


    // Souscriptions

    private subscribeNewTokens() {
        if (!this.ws || !this.isConnected) return;

        pumpWsApi.subscribeNewToken(this.ws);
    }

    public unsubscribeToNewTokens() {
        if (!this.ws || !this.isConnected) return;

        pumpWsApi.unsubscribeNewToken(this.ws);
    }

    public subscribeToTokens(tokenAddresses: string[]) {
        if (!this.ws || !this.isConnected) return;

        pumpWsApi.subscribeTokenTrade(this.ws, tokenAddresses);
    }

    public unsubscribeToTokens(tokenAddresses: string[]) {
        if (!this.ws || !this.isConnected) return;

        pumpWsApi.unsubscribeTokenTrade(this.ws, tokenAddresses);
    }

    public subscribeToTraders(accountAddresses: string[]) {
        if (!this.ws || !this.isConnected) return;

        pumpWsApi.subscribeAccountTrade(this.ws, accountAddresses);
    }

    public unsubscribeToTraders(accountAddresses: string[]) {
        if (!this.ws || !this.isConnected) return;

        pumpWsApi.unsubscribeAccountTrade(this.ws, accountAddresses);
    }
}



if (require.main === module) {
    const client = new PumpWebsocketApi(new ServiceManager);

    client.on('create', (data) => {
        console.log('New token created:', data);
    });

    client.on('trade', (data) => {
        console.log('Trade occurred:', data);
    });

    // Pour arrêter proprement le client
    process.on('SIGINT', async () => {
        console.log('Closing API WebSocket client...');
        await client.close();
        process.exit(0);
    });
}

