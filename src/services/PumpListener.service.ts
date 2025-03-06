// PumpListener.service.ts

import { ServiceManager } from "../managers/Service.manager";
import { Token, Trade } from "../models/Token.model";
import { ServiceAbstract } from "./abstract.service";
import { PriceFeed } from "./PriceFeed.service";


/* ######################################################### */


export type CreateTokenTxResult = {
    txType: 'create';
    signature: string;
    mint: string;
    traderPublicKey: string;
    bondingCurveKey: string;
    vTokensInBondingCurve: number;
    vSolInBondingCurve: number;
    marketCapSol: number;
    totalSupply: number;
    name: string;
    symbol: string;
    image: string;
    uri: string;
    website?: string;
    twitter?: string;
    telegram?: string;
    dataSource: string;
};


export type TokenTradeTxResult = {
    txType: 'sell' | 'buy';
    signature: string;
    mint: string;
    traderPublicKey: string;
    tokenAmount: number;
    solAmount: number;
    newTokenBalance?: number;
    bondingCurveKey: string;
    vTokensInBondingCurve: number;
    vSolInBondingCurve: number;
    marketCapSol: number;
    dataSource: string;
};



type WatchedDataSource = {
    listening: boolean,
    onNewToken: (newTokenData: CreateTokenTxResult) => void | null,
    onNewTrade: (tradeTokenData: TokenTradeTxResult) => void | null,
}


/* ######################################################### */


export class PumpListener extends ServiceAbstract {
    private watchedDataSources: Map<ServiceAbstract, WatchedDataSource> = new Map;


    start() {
        if (this.status !== 'stopped') return;
        super.start();

        this.watch(Array.from(this.watchedDataSources.keys()));

        super.started();
    }


    stop() {
        if (this.status !== 'started') return;
        super.stop();

        this.unwatch(Array.from(this.watchedDataSources.keys()));

        super.stopped();
    }



    watch(dataSources: ServiceAbstract[]) {
        for (const dataSource of dataSources) {
            let dataSourceInfos = this.watchedDataSources.get(dataSource)
            if (dataSourceInfos?.listening) continue;

            if (!dataSourceInfos) {
                // Ajout les dataSources non watchées

                const onNewToken = (newTokenData: CreateTokenTxResult) => {
                    this.handleNewToken(dataSource, newTokenData);
                }

                const onNewTrade = (tradeTokenData: TokenTradeTxResult) => {
                    this.handleNewTrade(dataSource, tradeTokenData);
                }

                this.watchedDataSources.set(dataSource, { listening: false, onNewToken, onNewTrade })
            }

            if (this.status === 'started') {
                // Ecoute les événements de chaque dataSources watchées (qui ne sont pas encore en écoute)
                dataSourceInfos = this.watchedDataSources.get(dataSource);

                if (dataSourceInfos) {
                    this.log(`Démarrage de l'écoute des événements du listener ${dataSource.constructor.name}...`)

                    dataSource.on('create', dataSourceInfos.onNewToken);
                    dataSource.on('trade', dataSourceInfos.onNewTrade);
                    dataSourceInfos.listening = true;
                }
            }
        }
    }


    unwatch(dataSources: ServiceAbstract[]) {
        for (const dataSource of dataSources) {
            const dataSourceInfos = this.watchedDataSources.get(dataSource)
            if (!dataSourceInfos) continue;

            this.log(`Arrêt de l'écoute des événements du listener ${dataSource.constructor.name}...`)

            dataSource.off('create', dataSourceInfos.onNewToken);
            dataSource.off('trade', dataSourceInfos.onNewTrade);

            dataSourceInfos.listening = false;
            this.watchedDataSources.delete(dataSource);
        }
    }



    private async handleNewToken(dataSource: ServiceAbstract, newTokenData: CreateTokenTxResult) {
        //console.log('DEBUG PumpListener: handleNewToken', newTokenData)

        // TODO: dédoublonner/filtrer les requetes recues

        const token: Token = this.createTokenFromTxResult(newTokenData);

        this.emit('new_token_received', token);
    }


    private async handleNewTrade(dataSource: ServiceAbstract, tradeTokenData: TokenTradeTxResult) {
        //console.log('DEBUG PumpListener: handleTrade', tradeTokenData)

        // TODO: dédoublonner/filtrer les requetes recues

        const trade: Trade = this.createTradeFromTxResult(tradeTokenData);

        this.emit('new_trade_received', trade);
    }


    /** Formatte un Token recu par le DataSource, au format exploitable par TokenManager */
    private createTokenFromTxResult(newTokenData: CreateTokenTxResult): Token {
        const solPrice: number = this.priceFeed.getSolPrice();

        const price = (newTokenData.vSolInBondingCurve / newTokenData.vTokensInBondingCurve);
        const marketCapSOL = newTokenData.marketCapSol;
        const marketCapUSD = newTokenData.marketCapSol * solPrice;
        const totalSupply = newTokenData.totalSupply;

        const newToken: Token = {
            address: newTokenData.mint,
            creator: newTokenData.traderPublicKey,
            name: newTokenData.name,
            symbol: newTokenData.symbol,
            uri: newTokenData.uri ?? '',
            image: newTokenData.image ?? '',
            website: newTokenData.website ?? '',
            twitter: newTokenData.twitter ?? '',
            telegram: newTokenData.telegram ?? '',
            createdAt: new Date(),
            totalSupply,
            marketCapSOL,
            marketCapUSD,
            price: price.toFixed(10),
            trades: [],
            holders: [],
            boundingCurve: {
                address: newTokenData.bondingCurveKey,
                percentage: 100,
                tokenAmount: totalSupply,
                solAmount: 0,
            },
            lastUpdated: new Date,
            analyticsSummary: null,
            trends: {},
            milestones: [],
            kpis: {
                priceMin: price.toFixed(10),
                priceMax: price.toFixed(10),
                marketCapUSDMin: marketCapUSD,
                marketCapUSDMax: marketCapUSD,
                holdersMin: 0,
                holdersMax: 0,
                devBalanceMin: null,
                devBalanceMax: null,
            },
        };

        return newToken;
    }


    /** Formatte un Trade recu par le DataSource, au format exploitable par TokenManager */
    private createTradeFromTxResult(tradeTokenData: TokenTradeTxResult): Trade {
        const solPrice: number = this.priceFeed.getSolPrice();

        const price = (tradeTokenData.vSolInBondingCurve / tradeTokenData.vTokensInBondingCurve).toFixed(10);
        const marketCapSOL = tradeTokenData.marketCapSol;
        const marketCapUSD = tradeTokenData.marketCapSol * solPrice;

        const trade: Trade = {
            timestamp: new Date(),
            tokenAddress: tradeTokenData.mint,
            traderAddress: tradeTokenData.traderPublicKey,
            type: tradeTokenData.txType,
            solAmount: tradeTokenData.solAmount,
            tokenAmount: tradeTokenData.tokenAmount,
            price,
            marketCapSOL,
            marketCapUSD,
        };

        return trade;
    }
}

