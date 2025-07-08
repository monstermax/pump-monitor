// pump_bot_mint_sniper.ts

import WebSocket from 'ws';
import base58 from 'bs58';
import { Connection, Keypair, SendTransactionError, VersionedTransactionResponse } from '@solana/web3.js';

import { appConfig } from "./env";
import { sleep } from './lib/utils/time.util';
import { retryAsync } from './lib/utils/promise.util';
import { padCenter } from './lib/utils/text.utils';
import { error, log, warn } from './lib/utils/console';
import { WebsocketHandlers, WsConnection } from './lib/utils/websocket';
import { asserts } from './lib/utils/asserts';
import { mockedSendSolanaTransaction, sendVersionedTransaction, TransactionResult } from './lib/solana/solana_tx_sender';
import { getDynamicPriorityFee } from './lib/solana/solana_tx_tools';
import { buildPortalBuyTransaction, buildPortalSellTransaction } from './lib/pumpfun/portal_tx/pumpfun_portal_api';
import { PumpTokenInfo, TradeInfo, TransactionDecoder } from './lib/pumpfun/pumpfun_tx_decoder';
import { PumpfunWebsocketApiSubscriptions } from './bot/websocket_subscriptions';
import { fastListenerMints, handleFastListenerPumpTransactionMessage } from './bot/solana_fast_listener_client';

import type { WsCreateTokenResult, WsPumpMessage, WsTokenTradeResult } from './monitor/listeners/PumpWebsocketApi.listener';
import type { BotSettings, FastListenerCreateTokenInput, Position, SelectedToken, Status, TokenKpis } from './bot/bot_types';


/* ######################################################### */


const positionsHistory: Position[] = [];

const botSettings: BotSettings = {
    minSolInWallet: 0.05,
    defaultBuyAmount: 0.001,
    minBuyAmount: 0.001,
    maxBuyAmount: 0.001,
    scoreMinForBuy: 60,
    scoreMinForSell: 60,
    stopLimit: 20,    // 20% => si on est en perte de plus de 20%
    takeProfit: 15,   // 50% => si on est en profit de plus de 30%
    trailingStop: 80, // 80% => si le prix est plus bas que 80% du max qu'on a connu
}

const fakeMode = true;

/* ######################################################### */


async function main() {

    const wallet: Keypair = fakeMode
        ? Keypair.generate()
        : Keypair.fromSecretKey(base58.decode(appConfig.solana.WalletPrivateKey));

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
            onerror: (ws: WebSocket, err: Error) => error(`❌ WebSocket ${connectionName} error: ${err.message}`),
            onreconnect: () => log(`📢 Tentative de reconnexion du websocket ${connectionName} ...`),
        }

        const wsPump = WsConnection(appConfig.websocketApi.url, wsHandlers);
        wsPump.connect();
    }


    if (false) {
        const connectionName = "Solana RPC WebSocket";

        const wsHandlers: WebsocketHandlers = {
            onconnect: (ws: WebSocket) => void (0),
            onmessage: (ws: WebSocket, data: WebSocket.Data) => handleFastListenerPumpTransactionMessage(ws, data),
            onclose: (ws: WebSocket) => log(`⚠️ WebSocket ${connectionName} closed`),
            onerror: (ws: WebSocket, err: Error) => error(`❌ WebSocket ${connectionName} error: ${err.message}`),
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
    private transactionDecoder = new TransactionDecoder;


    constructor(wallet: Keypair, botSettings?: BotSettings) {
        this.connection = new Connection(appConfig.solana.rpc.chainstack, { commitment: 'confirmed',  });
        this.wallet = wallet;
        this.settings = botSettings;

        if (fakeMode) {
            this.solBalance = { amount: 10, lastUpdated: new Date };

        } else {
            // Récupère la balance SOL du wallet
            this.connection.getBalance(this.wallet.publicKey)
                .then(balanceSol => {
                    this.solBalance = { amount: balanceSol / 1e9, lastUpdated: new Date };
                    log(`PumpBot 📢 => Balance Sol mise à jour : ${this.solBalance.amount.toFixed(9)} SOL`);
                });

            // Calcule les priorityFee recommandés
            getDynamicPriorityFee(this.connection)
                .then(priorityFee => this.priorityFee = priorityFee);
        }


        log(`PumpBot 📢 => Bot démarré sur le wallet ${this.wallet.publicKey.toBase58()}`);
    }


    startListeningForTokensMint(ws?: WebSocket) {
        if (this.status !== 'idle') {
            warn(`Etat "idle" requis`);
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
                log(`[API] Received CREATE  transaction for token ${message.mint}`)
                this.handlePumpCreateTokenMessage(message as WsCreateTokenResult);
            }

            if ('txType' in message && (message.txType === 'buy' || message.txType === 'sell')) {
                this.handlePumpTradeTokenMessage(message as WsTokenTradeResult);
            }

        } catch (err: any) {
            warn(`❌ Erreur de décodage du message ${data.toString()}`);
        }
    }


    /** Traite un message (create) recu sur par this.handlePumpApiMessage */
    private handlePumpCreateTokenMessage(mintMessage: WsCreateTokenResult) {

        if (this.status !== 'wait_for_buy') {
            warn(`handlePumpCreateTokenMessage => ⚠️ Etat "${this.status}" inattendu. Etat "wait_for_buy" requis. Mint ignoré`);
            return;
        }

        if (this.currentPosition) {
            warn(`handlePumpCreateTokenMessage => ⚠️ Mint inattendu. Une position est déjà ouverte. Mint ignoré`);
            return;
        }


        if (this.connection) {
            getTransaction(this.connection, mintMessage.signature)
                .then((transaction) => {
                    if (transaction) {
                        const tokenInfos = this.transactionDecoder.parsePumpTransactionResponse(transaction) as PumpTokenInfo;
                        //log('tokenInfos:', tokenInfos)

                        if (!this.currentPosition) {
                            this.autoBuy(mintMessage, tokenInfos);

                        } else {
                            warn(`handlePumpCreateTokenMessage => ⚠️ Transaction inattendue. Une position est déjà ouverte. Transaction ignorée`);
                        }
                    }
                })

        }

    }


    private handlePumpTradeTokenMessage(tradeMessage: WsTokenTradeResult) {

        if (this.status !== 'wait_for_sell') {
            //warn(`handlePumpTradeTokenMessage => ⚠️ Etat "${this.status}" inattendu. Etat "wait_for_sell" requis. Impossible de traiter le trade`);
            return;
        }

        if (!this.currentToken) {
            warn(`handlePumpTradeTokenMessage => ⚠️ Trade inattendu. Aucun token en position. Trade ignoré`);
            return;
        }

        if (!this.tokenInfos) {
            warn(`handlePumpTradeTokenMessage => ⚠️ Trade inattendu. Aucune infos sur le token selectionné. Trade ignoré`);
            return;
        }

        if (!this.currentPosition) {
            warn(`handlePumpTradeTokenMessage => ⚠️ Trade inattendu. Aucune position ouverte. Trade ignoré`);
            return;
        }

        if (tradeMessage.mint !== this.currentToken.tokenAddress) {
            warn(`handlePumpTradeTokenMessage => ⚠️ Trade du token ${tradeMessage.mint} inattendu. (token actif = ${this.currentToken.tokenAddress}). Trade ignoré`);
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



    private async autoBuy(mintMessage: WsCreateTokenResult, tokenInfos: PumpTokenInfo) {
        if (this.status !== 'wait_for_buy') {
            //warn(`autoBuy => ⚠️ Invalide statut ${this.status}. Impossible d'acheter`);
            return;
        }

        if (this.currentToken) {
            warn(`autoBuy => ⚠️ Un token est déjà en position => Achat annulé`);
            return;
        }

        if (this.currentPosition) {
            warn(`autoBuy => ⚠️ Une position est déjà ouverte => Achat annulé`);
            return;
        }

        const minSolInWalletDefault = 0.001;

        const maxSolAmount = (this.solBalance?.amount ?? 0) - (this.settings?.minSolInWallet ?? minSolInWalletDefault);

        const checkForBuyResult = await this.evaluateTokenForBuy(mintMessage, tokenInfos, maxSolAmount);

        if (checkForBuyResult.canBuy) {
            log(); // ligne vide
            log(`autoBuy => 💡 Recommandation d'achat => ${checkForBuyResult.amount} SOL (${checkForBuyResult.reason})`);
            log(); // ligne vide

            if (this.pumpfunWebsocketApiSubscriptions) {
                this.pumpfunWebsocketApiSubscriptions.unsubscribeNewTokens();

                this.pumpfunWebsocketApiSubscriptions.subscribeToTokens([mintMessage.mint]);

            } else {
                warn(`autoBuy => ⚠️ Souscriptions websocket non disponibles => Achat annulé`);
                return;
            }


            this.status = 'buying';
            this.currentToken = { tokenAddress: mintMessage.mint, mintMessage, tradesMessages: [], holders: new Map };
            this.tokenInfos = tokenInfos;

            const buySolAmount = checkForBuyResult.amount; // TODO: Math.min(balanceSol, checkForBuyResult.amount)

            if (this.settings?.minSolInWallet && buySolAmount > maxSolAmount && ! fakeMode) {
                warn(`autoBuy => ⚠️ Montant demandé (${buySolAmount}) supérieur à la somme disponible (${maxSolAmount}) => Achat refusé`);
                return;
            }

            if (this.settings?.minBuyAmount && buySolAmount < this.settings.minBuyAmount) {
                warn(`autoBuy => ⚠️ Montant demandé (${buySolAmount}) inférieur au minimum autorisé (${this.settings.minBuyAmount}) => Achat annulé`);
                return;
            }


            this.buyToken(tokenInfos, buySolAmount)
                .then(() => {
                    // surveiller les opportunités de vente
                    this.watchForSell(tokenInfos);
                })
                .catch((err: any) => {
                    warn(`❌ Achat échoué. ${err.message}`);

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
            warn(`autoSell => ⚠️ Invalide statut ${this.status} => Vente annulée`);
            return;
        }

        if (!this.currentToken) {
            warn(`autoSell => ⚠️ Aucun token en position => Vente annulée`);
            return;
        }

        if (!this.currentPosition) {
            warn(`autoSell => ⚠️ Aucune position ouverte => Vente annulée`);
            return;
        }

        if (tokenInfos.tokenAddress !== this.currentToken.tokenAddress) {
            warn(`autoSell => ⚠️ Trade du token ${tokenInfos.tokenAddress} inattendu. (token actif = ${this.currentToken.tokenAddress}) => Vente annulée`);
            return;
        }


        const checkForSellResult = await this.evaluateTokenForSell(this.currentToken, this.currentPosition, tokenInfos);

        if (checkForSellResult.canSell) {
            log(); // pour cloturer les 2 lignes dynamiques
            log(); // pour cloturer les 2 lignes dynamiques
            log(); // ligne vide
            log(`💡 Recommandation de vente => ${checkForSellResult.amount} ${tokenInfos.tokenSymbol} (${checkForSellResult.reason})`);

            this.status = 'selling';
            const sellTokenAmount = checkForSellResult.amount;

            this.sellToken(tokenInfos.tokenAddress, sellTokenAmount)
                .then(() => {
                    // Ré-écouter les mint de tokens
                    this.startListeningForTokensMint();
                })
                .catch((err: any) => {
                    warn(`❌ Vente échouée. ${err.message}`);

                    this.status = 'delaying';
                    setTimeout(() => this.status = 'wait_for_sell', 5_000);
                })
        }
    }


    private watchForSell(tokenInfos: PumpTokenInfo) {

        if (this.status !== 'hold') {
            warn(`watchForSell => ⚠️ Etat "${this.status}" inattendu. Etat "hold" requis. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentToken) {
            warn(`watchForSell => ⚠️ Aucun token en position. Surveillance des ventes abandonnée`);
            return;
        }

        if (tokenInfos.tokenAddress !== this.currentToken.tokenAddress) {
            warn(`watchForSell => ⚠️ Token inattendu. Surveillance des ventes abandonnée`);
            return;
        }

        if (!this.currentPosition) {
            warn(`watchForSell => ⚠️ Aucune position ouverte. Surveillance des ventes abandonnée`);
            return;
        }


        log(`👀 Mise en attente d'opportunité de vente du token ${this.currentToken.tokenAddress}`);
        log()

        this.status = 'wait_for_sell';


        const mintDate = tokenInfos.createdAt;
        //const myBuy = this.currentToken.tradesMessages.find(trade => trade.txType === 'buy' && trade.traderPublicKey === this.wallet.publicKey.toBase58());
        const buyDate = this.currentPosition.timestamp;

        let lastLogTime = 0;
        //let firstPrice: null | string = null;
        const watchedTokenAddress = this.currentToken.tokenAddress;


        const logIntervalId = setInterval(() => {
            if (watchedTokenAddress !== this.currentToken?.tokenAddress || ! this.currentPosition || this.status !== 'wait_for_sell') {
                //warn(`watchForSell => ⚠️ Changement du contexte. Surveillance des ventes stoppée`);
                clearInterval(logIntervalId);
                return;
            }

            if (! this.currentKpis) {
                warn(`watchForSell => ⚠️ Pas de KPI trouvé pour le token. Surveillance des ventes dégradée`);
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

            const inactivityAge = (Date.now() - tokenInfos.lastUpdated.getTime()) / 1000;
            const mintAge = (Date.now() - mintDate.getTime()) / 1000;
            const buyAge = (Date.now() - buyDate.getTime()) / 1000;
            const positionAge = (Date.now() - this.currentPosition.timestamp.getTime()) / 1000;

            const volumeSol = this.currentToken?.tradesMessages.map(trade => trade.solAmount).reduce((p,c) => p + c, 0);

            const { buyPrice, tokenAmount, currentPrice, profit } = this.currentKpis;

            const infosLine1 = [
                //`${formatAddress(watchedTokenAddress)}`,
                `Buy: ${solToLamp(buyPrice)} LAMP`,
                `Prix: ${solToLamp(currentPrice)} LAMP`,
                //`Qté: ${tokenAmount.toFixed(0)}`,
                `Age: ${formatDuration(mintAge)}`,
                `BuyAge: ${formatDuration(buyAge)}`,
                `PosAge: ${formatDuration(positionAge)}`,
                `Inact.: ${formatDuration(inactivityAge)}`,
                `Holders: ${this.currentToken.holders.size}`,
                `Trades: ${this.currentToken?.tradesMessages.length || 0}`,
                `Vol: ${volumeSol.toFixed(3)} SOL`,
                //`Dev: -1 SOL (-1%)`,
            ];

            const infosLine2 = [
                `Profit: ${profit.toFixed(2)}%`,
                `Buy/3: ${this.currentKpis.lastTrades3BuyPercent.toFixed(1)}%`,
                `Buy/5: ${this.currentKpis.lastTrades5BuyPercent.toFixed(1)}%`,
                `Min: ${solToLamp(this.currentKpis.minPrice)}%`,
                `Max: ${solToLamp(this.currentKpis.maxPrice)}%`,
                `ATH%: ${this.currentKpis.percentOfAth.toFixed(1)}`,
                `Scores: ${JSON.stringify(this.currentKpis.weightedScore)}`,
                `Score: ${this.currentKpis.finalScore}`,
            ];

            // afficher un message dynamique sur la console : buyPrice | buyMarketCap | currentPrice | currentMarketCap | trades | holders | gain | gainVsMaxGain | mintAge | buyAge | lastActivityAge

            //process.stdout.write(`\r$${infosLine1.join(' | ')}`);

            // Efface les lignes précédentes et positionne le curseur
            process.stdout.write('\r\x1b[K'); // Efface la ligne actuelle
            process.stdout.write(`            ${infosLine1.join(' | ')}`);
            process.stdout.write('\n\r\x1b[K'); // Nouvelle ligne et efface
            process.stdout.write(`            ${infosLine2.join(' | ')}`);
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
            warn(`buyToken => ⚠️ Processus d'achat non initié`);
            return;
        }

        if (!this.currentToken) {
            warn(`buyToken => ⚠️ Aucun token actif => Achat annulé`);
            return;
        }

        if (tokenInfos.tokenAddress !== this.currentToken.tokenAddress) {
            warn(`buyToken => ⚠️ Achat sur le mauvais token => Achat annulé`);
            return;
        }

        if (this.currentPosition) {
            warn(`buyToken => ⚠️ Une position est déjà ouverte => Achat annulé`);
            return;
        }

        if (!this.connection) {
            warn(`buyToken => ⚠️ Aucune connexion solana/web3 ouverte => Achat annulé`);
            return;
        }


        log()
        log('#'.repeat(100))
        log(padCenter(`⏳ Process d'achat initié => token ${tokenInfos.tokenAddress}`, 100))
        log('#'.repeat(100))
        log()


        log(`1️⃣ Achat en cours du token ${this.currentToken.tokenAddress}`);


        // 1) créer transaction buy
        const tx = await buildPortalBuyTransaction(this.wallet.publicKey, this.currentToken.tokenAddress, solAmount, this.slippage, this.priorityFee);
        //log('buy tx:', tx);

        log(`2️⃣ Achat en cours du token ${this.currentToken.tokenAddress}`);



        // 2) envoyer transaction buy
        tx.sign([this.wallet]);

        const txResult: TransactionResult = fakeMode
            ? await mockedSendSolanaTransaction('buy') // DEBUG/TEST
            : await sendVersionedTransaction(this.connection, tx);


        if (!txResult.success || !txResult.signature) {

            if (true) {
                warn(`Erreur pendant l'achat`);

                if (txResult.error) {
                    warn(` - message: ${txResult.error.message}`);

                    if (txResult.error instanceof SendTransactionError) {
                        txResult.error.logs?.forEach(log => {
                            warn(` - log: ${log}`);
                        })
                    }

                    //log('ERR', txResult.error.transactionError)
                }
            }

            throw new Error(`Erreur pendant l'achat. ${txResult.error?.message ?? txResult.error?.message ?? ''}`);
        }

        log(`⌛ Attente Transaction: 🔗 https://solscan.io/tx/` + txResult.signature);


        // 3) attendre et récupérer transaction buy
        const txResponseResult = txResult.results ?? await getTransaction(this.connection, txResult.signature);

        //log(`✔️ Transaction d'achat récupérée`);


        // 4) Décoder la transaction et récupérer les nouveaux soldes (SOL et tokens)
        if (!txResponseResult) throw new Error(`Erreur de décodage de la transaction d'achat`);
        const pumpResult = this.transactionDecoder.parsePumpTransactionResponse(txResponseResult) as TradeInfo;

        log(`✅ Transaction d'achat décodée => prix d'achat = ${pumpResult.price} SOL`);

        //log(`Détails pour analyse du prix d'achat :`, pumpResult)

        // Mise à jour des balances
        const checkedTokenBalance = { amount: pumpResult.traderPostBalanceToken, lastUpdated: pumpResult.timestamp };

        this.solBalance = { amount: pumpResult.traderPostBalanceSol, lastUpdated: pumpResult.timestamp };

        log(`⚖️ Balances UPDATED => ${this.solBalance.amount.toFixed(9)} SOL | ${checkedTokenBalance.amount.toFixed(9)} ${tokenInfos.tokenSymbol}`);


        // Création de la position
        this.currentPosition = {
            tokenAddress: this.currentToken.tokenAddress,
            preBalance: pumpResult.traderPreBalanceSol,
            postBalance: null,
            buySolCost: pumpResult.traderPreBalanceSol - pumpResult.traderPostBalanceSol,
            recommandedSolAmount: solAmount,
            buyPrice: pumpResult.price,
            buySolAmount: pumpResult.solAmount,
            tokenAmount: pumpResult.tokenAmount,
            checkedBalance: checkedTokenBalance,
            sellSolReward: null,
            profit: null,
            timestamp: new Date((txResponseResult.blockTime ?? Date.now()/1000) * 1000),
        }

        this.status = 'hold';

        log(`3️⃣ Achat en cours du token ${this.currentToken.tokenAddress}`);

        log()
        log('#'.repeat(100))
        log(padCenter(`🏁 process d'achat terminé => token ${this.currentToken.tokenAddress}`, 100))
        log('#'.repeat(100))
        log()
        log(`🔗 https://pump.fun/coin/${this.currentToken.tokenAddress}`);
        log()

    }


    private async sellToken(tokenAddress: string, tokenAmount: number) {
        if (this.status !== 'selling') {
            warn(`sellToken => ⚠️ Processus de vente non initié`);
            return;
        }

        if (!this.currentToken) {
            warn(`sellToken => ⚠️ Aucun token actif => Vente annulée`);
            return;
        }

        if (tokenAddress !== this.currentToken.tokenAddress) {
            warn(`sellToken => ⚠️ Vente du mauvais token => Vente annulée`);
            return;
        }

        if (!this.currentPosition) {
            warn(`sellToken => ⚠️ Aucune position ouverte => Vente annulée`);
            return;
        }

        if (!this.connection) {
            warn(`sellToken => ⚠️ Aucune connexion solana/web3 ouverte => Vente annulée`);
            return;
        }


        log();
        log('#'.repeat(100))
        log(padCenter(`⏳ Process de vente initié => token ${tokenAddress}`, 100))
        log('#'.repeat(100))
        log()


        log(`1️⃣ Vente en cours du token ${tokenAddress}`);

        // TODO

        // 1) créer transaction sell
        const tx = await buildPortalSellTransaction(this.wallet.publicKey, tokenAddress, tokenAmount, this.slippage, this.priorityFee);
        //log('sell tx:', tx);

        log(`2️⃣ Vente en cours du token ${tokenAddress}`);


        // 2) envoyer transaction sell
        tx.sign([this.wallet]);

        const txResult: TransactionResult = fakeMode
            ? await mockedSendSolanaTransaction('sell') // DEBUG/TEST
            : await sendVersionedTransaction(this.connection, tx);


        if (!txResult.success || !txResult.signature) {

            if (true) {
                warn(`Erreur pendant la vente`);

                if (txResult.error) {
                    warn(` - message: ${txResult.error.message}`);

                    if (txResult.error instanceof SendTransactionError) {
                        txResult.error.logs?.forEach(log => {
                            warn(` - log: ${log}`);
                        })
                    }

                    //log('ERR', txResult.error.transactionError)
                }
            }

            throw new Error(`Erreur pendant la vente. ${txResult.error?.message ?? txResult.error?.message ?? ''}`);
        }

        log(`⌛ Attente Transaction: 🔗 https://solscan.io/tx/` + txResult.signature);


        // 3) attendre et récupérer transaction sell
        const txResponseResult = txResult.results ?? await getTransaction(this.connection, txResult.signature);

        //log(`✔️ Transaction de vente récupérée`);


        // 4) Décoder la transaction et récupérer les nouveaux soldes (SOL et tokens)
        if (!txResponseResult) throw new Error(`Erreur de décodage de la transaction de vente`);
        const pumpResult = this.transactionDecoder.parsePumpTransactionResponse(txResponseResult) as TradeInfo;

        log(`✅ Transaction de vente décodée => prix de vente = ${pumpResult.price} SOL`);

        //log(`Détails pour analyse du prix de vente :`, pumpResult)


        // Mise à jour des balances
        const checkedTokenBalance = { amount: pumpResult.traderPostBalanceToken, lastUpdated: pumpResult.timestamp };

        this.solBalance = { amount: pumpResult.traderPostBalanceSol, lastUpdated: pumpResult.timestamp };

        log(`⚖️ Balances UPDATED => ${this.solBalance.amount.toFixed(9)} SOL | ${checkedTokenBalance.amount.toFixed(9)} ${this.currentToken.mintMessage.symbol}`);



        // Mise à jour de la position
        const positionUpdate: Partial<Position> = {
            sellPrice: pumpResult.price,
            sellSolAmount: pumpResult.solAmount,
            tokenAmount: pumpResult.tokenAmount,
            postBalance: this.solBalance?.amount,
            sellSolReward: pumpResult.traderPreBalanceSol - pumpResult.traderPostBalanceSol,
            profit: 100 * (Number(pumpResult.price) - Number(this.currentPosition.buyPrice)) / Number(this.currentPosition.buyPrice),
        }

        Object.assign(this.currentPosition, positionUpdate);


        if (checkedTokenBalance.amount !== 0) {
            warn(`⚠️ Solde de tokens non nul après la vente. Process stoppé pour analyse.`);

            if (checkedTokenBalance.amount >= 1) {
                warn(`⚠️ Process stoppé pour analyse.`);
                process.exit();
            }
        }

        // Historise la position
        positionsHistory.push(this.currentPosition);


        // Mise à jour des souscriptions websocket
        if (this.pumpfunWebsocketApiSubscriptions) {
            this.pumpfunWebsocketApiSubscriptions.unsubscribeToTokens([tokenAddress]);
        }


        log(`3️⃣ Vente en cours du token ${tokenAddress}`);

        const gain = (this.currentPosition.postBalance ?? 0) - this.currentPosition.preBalance;

        if (gain > 0) {
            log(`🎉 Gain = ${(gain).toFixed(3)} SOL (${(100 * gain / this.currentPosition.buySolCost).toFixed(2)} %)`);

        } else if (gain < 0) {
            log(`💀 Gain = ${(gain).toFixed(3)} SOL (${(100 * gain / this.currentPosition.buySolCost).toFixed(2)} %)`);

        } else {
            log(`👉 Gain = ${(gain).toFixed(3)} SOL`);
        }


        this.setStatus('idle');
        //this.status = 'idle';
        //this.currentToken = null;
        //this.currentPosition = null;
        //this.currentKpis = null;

        log()
        log('#'.repeat(100))
        log(padCenter(`🏁 process de vente terminé => token ${tokenAddress}`, 100))
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
                ? 50
                : tokenAge <= 3
                    ? 40
                    : tokenAge <= 5
                        ? 30
                        : 20;

        let buySolScore = devBuySolAmount <= 0.1
            ? 70
            : devBuySolAmount <= 0.5
                ? 60
                : devBuySolAmount <= 1
                    ? 40
                    : 20;

        let buyTokenPercentageScore = devBuyTokenPercentage <= 1
            ? 70
            : devBuyTokenPercentage <= 2
                ? 60
                : devBuyTokenPercentage <= 5
                    ? 40
                    : 20;


        // Calculer le score global avec pondérations
        const weightedScore = [
            [Math.round(ageScore), 50],
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
                `🆕 Mint: ${mintMessage.mint}`,
                `Age: ${tokenAge.toFixed(1)} s.`,
                `Dev: ${devBuySolAmount.toFixed(3)} SOL (${devBuyTokenPercentage.toFixed(2)} %)`,
                `Scores: ${JSON.stringify(weightedScore)}`,
                `Score: ${finalScore}`,
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

            if ((buyMaxAmount <= buyMinAmount || solAmount <= 0) && ! fakeMode) {
                warn(`evaluateTokenForBuy => ⚠️ Balance SOL insuffisante`);
                process.exit();
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
        const lastTrades3BuyPercent = lastTrades3.length > 0 ? (75 - (100 * lastTrades3Buy / lastTrades3.length) / 2) : 50; // score normalisé entre 25% et 75%
        const lastTrades3SellPercent = lastTrades3.length > 0 ? (75 - (100 * lastTrades3Sell / lastTrades3.length) / 2) : 50; // score normalisé entre 25% et 75%

        const lastTrades5 = lastTrades100.slice(-5);
        const lastTrades5Buy = lastTrades5.filter(trade => trade.txType === 'buy').length;
        const lastTrades5Sell = lastTrades5.length - lastTrades5Buy;
        const lastTrades5BuyPercent = lastTrades5.length > 1 ? (75 - (100 * lastTrades5Buy / lastTrades5.length) / 2) : 50; // score normalisé entre 25% et 75%
        const lastTrades5SellPercent = lastTrades5.length > 1 ? (75 - (100 * lastTrades5Sell / lastTrades5.length) / 2) : 50; // score normalisé entre 25% et 75%

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
        const athScore = isNaN(percentOfAth)
            ? 50
            : percentOfAth < 0
                ? 80
                : percentOfAth < 50
                    ? 75
                    : percentOfAth < 75
                        ? 70
                        : percentOfAth < 100
                            ? 60
                            : 30

        // plus le inactivityAge est grand plus on a de raison de vendre
        const inactivityScore = inactivityAge >= 30
            ? 80
            : inactivityAge >= 10
                ? 70
                : inactivityAge >= 5
                    ? 60
                    : inactivityAge >= 3
                        ? 50
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
            [Math.round(athScore), 20],
            [Math.round(ageScore), 10],
            [Math.round(inactivityScore), 50],
            [Math.round(lastTrades3SellPercent), 30],
            [Math.round(lastTrades5SellPercent), 10],
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
            warn(`evaluateTokenForSell => ⚠️ Balance Token insuffisante`);
            return { canSell: false, amount: 0, reason: `Balance Token insuffisante` }
        }


        if (finalScore >= (this.settings?.scoreMinForSell ?? 60)) {
            return { canSell: true, amount: tokenAmount, reason: `Score de ventes - ${finalScore}/100 - satisfaisant` } // TODO: a decouper en (vente gagnante) et (vente perdante)

        } else if (profit < -(this.settings?.stopLimit ?? 20)) {
            return { canSell: true, amount: tokenAmount, reason: `Stop Limit @ ${profit.toFixed(1)}% profit` };

        } else if (profit > (this.settings?.takeProfit ?? 100)) {
            return { canSell: true, amount: tokenAmount, reason: `Take Profit @ ${profit.toFixed(1)}% profit` }

        } else if (positionAge > 10 && lastTrades100.length >= 15 && percentOfAth > 0 && percentOfAth < (this.settings?.trailingStop ?? 80)) {
            return { canSell: true, amount: tokenAmount, reason: `Trailing Stop @ ${profit.toFixed(1)}% profit & ${percentOfAth.toFixed(1)}% of ATH` }

        } else {
            return { canSell: false, amount: 0, reason: `Condition de ventes non satisfaites` }
        }
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
    //const retriever = () => retrieveTransactionResultWithBlocksListener(signature);

    return retriever();
}

/*
async function retrieveTransactionResultWithBlocksListener(signature: string, timeout = 15_000): Promise<VersionedTransactionResponse | null> {
    let transaction: VersionedTransactionResponse | undefined = blocksListenerMints.get(signature)
    const tsEnd = Date.now() + timeout;

    while (!transaction && Date.now() < tsEnd) {
        transaction = blocksListenerMints.get(signature)
        if (transaction) break;

        //warn(`Transaction ${signature} non trouvée dans les ${fastListenerMints.size} transactions de FastListener.`);

        await sleep(50);
    }

    return transaction ?? null;
}
*/


async function retrieveMintTransactionResultWithFastListener(signature: string, timeout = 15_000): Promise<FastListenerCreateTokenInput | null> {
    let mintInput: FastListenerCreateTokenInput | undefined = fastListenerMints.get(signature)
    const tsEnd = Date.now() + timeout;

    while (!mintInput && Date.now() < tsEnd) {
        mintInput = fastListenerMints.get(signature)
        if (mintInput) break;

        //warn(`Transaction ${signature} non trouvée dans les ${fastListenerMints.size} transactions de FastListener.`);

        await sleep(50);
    }

    return mintInput ?? null;
}


function solToLamp(solAmount: number | string | bigint): number {
    return Number(solAmount) * 1e9;
}


function formatDuration(seconds: number) {
    if (seconds > 86400) return `${(seconds/86400).toFixed(1)} d.`;

    if (seconds > 3600) return `${(seconds/3600).toFixed(1)} h.`;

    if (seconds > 60) return `${(seconds/60).toFixed(1)} m.`;

    return `${seconds.toFixed(2)} s.`
}


/* ######################################################### */


// Démarrer le programme
main().catch((err: any) => {
    error('Erreur fatale:', err);
    process.exit(1);
});


