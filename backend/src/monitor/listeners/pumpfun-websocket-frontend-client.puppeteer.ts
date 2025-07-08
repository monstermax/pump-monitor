// pumpfun-websocket-frontend-client.puppeteer.ts

import * as puppeteer from 'puppeteer';
import EventEmitter from 'events';
import { CreateTokenTxResult, TokenTradeTxResult } from '../services/PumpListener.service';


/* ######################################################### */


export type ServerInfoMessage = {
    server_id: string
    server_name: string
    version: string
    proto: number
    git_commit: string
    go: string
    host: string
    port: number
    headers: boolean
    auth_required: boolean
    max_payload: number
    client_id: number
    client_ip: string
    cluster: string
    connect_urls: string[]
    xkey: string
};


export type MintMessage = {
    mint: string
    name: string
    symbol: string
    description: string
    image_uri: string
    metadata_uri: string
    twitter: any
    telegram: any
    bonding_curve: string
    associated_bonding_curve: string
    creator: string
    created_timestamp: number
    raydium_pool: any
    complete: boolean
    virtual_sol_reserves: number
    virtual_token_reserves: number
    hidden: any
    total_supply: number
    website: any
    show_name: boolean
    last_trade_timestamp: any
    king_of_the_hill_timestamp: any
    market_cap: number
    nsfw: boolean
    market_id: any
    inverted: any
    real_sol_reserves: number
    real_token_reserves: number
    livestream_ban_expiry: number
    last_reply: any
    reply_count: number
    is_banned: boolean
    is_currently_live: boolean
    initialized: boolean
    video_uri: any
    updated_at: any
    usd_market_cap: number
}


export type TradeCreatedMessage = [string, TradeCreatedMessageObj]


export type TradeCreatedMessageObj = {
    signature: string
    sol_amount: number
    token_amount: number
    is_buy: boolean
    user: string
    timestamp: number
    mint: string
    virtual_sol_reserves: number
    virtual_token_reserves: number
    slot: number
    tx_index: number
    name: string
    symbol: string
    description: string
    image_uri: string
    video_uri: any
    metadata_uri: string
    twitter: string
    telegram: any
    bonding_curve: string
    associated_bonding_curve: string
    creator: string
    created_timestamp: number
    raydium_pool: any
    complete: boolean
    total_supply: number
    website: any
    show_name: boolean
    king_of_the_hill_timestamp: number
    market_cap: number
    reply_count: number
    last_reply: number
    nsfw: boolean
    market_id: any
    inverted: any
    is_currently_live: boolean
    creator_username: any
    creator_profile_image: any
    usd_market_cap: number
}




/* ######################################################### */


/**
 * Client WebSocket qui utilise Puppeteer pour capturer les messages
 * WebSocket de Pump.fun à travers un navigateur
 */
export class PuppeteerWebSocketClient extends EventEmitter {
    private browser: puppeteer.Browser | null = null;
    private page: puppeteer.Page | null = null;
    private client: puppeteer.CDPSession | null = null;
    private isConnected: boolean = false;
    private reconnectTimeout: NodeJS.Timeout | null = null;

    constructor() {
        super();
        this.connect();
    }


    /** Connexion au websocket Pump.fun via Puppeteer */
    private async connect() {
        try {
            // Lancer le navigateur en mode headless
            this.browser = await puppeteer.launch({
                //headless: 'shell',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            this.page = await this.browser.newPage();

            // Se connecter à la page principale de Pump.fun
            const url = 'https://pump.fun/board';
            await this.page.goto(url);

            // Créer une session CDP pour surveiller le trafic WebSocket
            this.client = await this.page.target().createCDPSession();

            // Activer la surveillance du réseau
            await this.client.send('Network.enable');

            // Mettre en place les écouteurs d'événements WebSocket
            this.setupEventListeners();

            this.isConnected = true;
            console.log('✔️ Connected to PumpFun FRONTEND WebSocket (PuppeteerWebSocketClient)');

            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = null;
            }
        } catch (error) {
            console.error('Error connecting to Pump.fun via Puppeteer:', error);
            this.cleanup();
            this.scheduleReconnect();
        }
    }


    /** Met en place les écouteurs d'événements WebSocket */
    private setupEventListeners() {
        if (!this.client) return;

        // Lors de la création d'un WebSocket
        this.client.on('Network.webSocketCreated', ({ requestId, url }) => {
            console.log('WebSocket created:', url);
        });

        // Lors de la fermeture d'un WebSocket
        this.client.on('Network.webSocketClosed', ({ requestId, timestamp }) => {
            console.log('WebSocket closed');
            this.isConnected = false;
            this.cleanup();
            this.scheduleReconnect();
        });

        // Lorsqu'un message est reçu sur le WebSocket
        this.client.on('Network.webSocketFrameReceived', ({ requestId, timestamp, response }) => {
            this.handleMessage(response.payloadData);
        });
    }


    /** Traite un message reçu du WebSocket */
    private handleMessage(payloadData: string) {
        try {
            let json: string | null = null;

            // Parsing initial basé sur les préfixes
            if (payloadData.startsWith('42[')) {
                json = payloadData.slice(2);

            } else if (payloadData.startsWith('0{')) {
                json = payloadData.slice(1);

            } else {
                // Essayer de décoder en base64
                json = this.base64Decode(payloadData);

                if (json.startsWith('INFO {')) {
                    json = json.slice(5);
                }

                if (json.startsWith('MSG newCoinCreated.prod')) {
                    json = json.slice(json.indexOf('{'));
                }
            }

            if (!json) {
                if (payloadData.length >= 5) {
                    console.log('nojson payloadData:', payloadData);
                }
                return;
            }

            if ((json.startsWith('[') || json.startsWith('{'))) {
                let message: MintMessage | TradeCreatedMessage | ServerInfoMessage | null = null;

                // Tentative de nettoyage pour contourner l'erreur => Bad control character in string literal in JSON at position xxx
                //json = Buffer.from(json).toString('utf-8');
                //json = Buffer.from(json).toString('latin1');
                //json = cleanString(json);

                try {
                    message = JSON.parse(json) as MintMessage | TradeCreatedMessage | ServerInfoMessage;

                } catch (err: any) {
                    console.warn(`WARNING: json decode error. ${err.message}`);
                    return;
                }

                if (Array.isArray(message)) {
                    // Message de trade
                    const tradeMessage: TradeCreatedMessageObj = message[1];
                    //console.log(`TRADE: ${tradeMessage.mint} | ${tradeMessage.is_buy ? 'BUY' : 'SELL'} | ${(tradeMessage.sol_amount / 1e9).toFixed(3)} SOL | ${tradeMessage.symbol} | ${tradeMessage.name}`);

                    // Convertir au format compatible avec votre système
                    const compatTradeData: TokenTradeTxResult = {
                        signature: tradeMessage.signature,
                        mint: tradeMessage.mint,
                        traderPublicKey: tradeMessage.user,
                        txType: tradeMessage.is_buy ? 'buy' as const : 'sell' as const,
                        tokenAmount: tradeMessage.token_amount / 1e6,
                        solAmount: tradeMessage.sol_amount / 1e9,
                        //newTokenBalance: 0,  // Non disponible
                        bondingCurveKey: tradeMessage.bonding_curve,
                        vTokensInBondingCurve: tradeMessage.virtual_token_reserves,
                        vSolInBondingCurve: tradeMessage.virtual_sol_reserves,
                        marketCapSol: tradeMessage.market_cap,
                        instructionIdx: 0,
                        price: (tradeMessage.virtual_token_reserves / tradeMessage.virtual_sol_reserves).toFixed(10),
                        slot: 0,
                        timestamp: new Date(tradeMessage.timestamp * 1000),
                        tokenPostBalance: 0,
                        dataSource: 'PuppeteerWebSocketClient',
                    };

                    this.emit('trade', compatTradeData);

                } else if ('server_id' in message) {
                    // Message d'information serveur
                    const serverInfo: ServerInfoMessage = message;
                    console.log(`Server info received: ${serverInfo.server_name || 'unknown'} v${serverInfo.version || 'unknown'}`);

                } else if ('mint' in message) {
                    // Message de création de token (mint)
                    const mintMessage: MintMessage = message;

                    if (!mintMessage.mint) {
                        console.log('nomint payloadData:', payloadData);
                        return;
                    }

                    //console.log(`MINT: ${mintMessage.mint} | MINT | MARKET_CAP ${mintMessage.usd_market_cap.toFixed(2)} USD | ${mintMessage.symbol} | ${mintMessage.name}`);

                    const compatMintData: CreateTokenTxResult = {
                        signature: `tx-created-${mintMessage.mint}`,
                        mint: mintMessage.mint,
                        traderPublicKey: mintMessage.creator,
                        txType: 'create' as const,
                        //initialBuy: 0,  // Non disponible
                        //solAmount: mintMessage.virtual_sol_reserves / 1e9,
                        bondingCurveKey: mintMessage.bonding_curve,
                        vTokensInBondingCurve: mintMessage.virtual_token_reserves,
                        vSolInBondingCurve: mintMessage.virtual_sol_reserves,
                        marketCapSol: mintMessage.market_cap,
                        name: mintMessage.name,
                        symbol: mintMessage.symbol,
                        uri: mintMessage.metadata_uri,
                        dataSource: 'PuppeteerWebSocketClient',
                        totalSupply: mintMessage.total_supply,
                        twitter: mintMessage.twitter,
                        telegram: mintMessage.telegram,
                        image: mintMessage.image_uri,
                        website: mintMessage.website,
                        createdAt: new Date,
                        instructionIdx: 0,
                        price: (mintMessage.virtual_token_reserves / mintMessage.virtual_sol_reserves).toFixed(10),
                        updatedAt: new Date,
                    };

                    this.emit('create', compatMintData);
                }
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }

    /**
     * Décode une chaîne base64 en ASCII
     */
    private base64Decode(encoded: string): string {
        try {
            return Buffer.from(encoded, 'base64').toString('ascii');

        } catch (error) {
            return ''; // Retourner une chaîne vide en cas d'échec
        }
    }

    /**
     * Nettoyage des ressources après déconnexion
     */
    private async cleanup() {
        this.isConnected = false;

        if (this.client) {
            await this.client.detach().catch(() => { });
            this.client = null;
        }

        if (this.page) {
            await this.page.close().catch(() => { });
            this.page = null;
        }

        if (this.browser) {
            await this.browser.close().catch(() => { });
            this.browser = null;
        }
    }

    /**
     * Programme une reconnexion
     */
    private scheduleReconnect() {
        if (!this.reconnectTimeout) {
            this.reconnectTimeout = setTimeout(() => {
                console.log('Attempting to reconnect via Puppeteer...');
                this.connect();
            }, 5000); // Reconnexion après 5 secondes
        }
    }

    /**
     * Ferme la connexion et nettoie les ressources
     */
    public async close() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        await this.cleanup();
        console.log('PuppeteerWebSocketClient closed');
    }
}


function cleanString(input: string): string {
    var output = "";
    for (var i=0; i<input.length; i++) {
        if (input.charCodeAt(i) <= 127) {
            output += input.charAt(i);
        }
    }
    return output;
}



if (require.main === module) {
    const client = new PuppeteerWebSocketClient();

    client.on('create', (data) => {
        console.log('New token created:', data);
    });

    client.on('trade', (data) => {
        console.log('Trade occurred:', data);
    });

    // Pour arrêter proprement le client
    process.on('SIGINT', async () => {
        console.log('Closing Puppeteer WebSocket client...');
        await client.close();
        process.exit(0);
    });
}


