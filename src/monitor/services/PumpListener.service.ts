// PumpListener.service.ts

import { VersionedTransactionResponse } from "@solana/web3.js";
import { ServiceManager } from "../managers/Service.manager";
import { Token, TokenHolder, Trade } from "../models/Token.model";
import { ServiceAbstract } from "./abstract.service";
import { PriceFeed } from "./PriceFeed.service";


/* ######################################################### */


export type CreateTokenTxResult = {
    txType: 'create';
    signature: string;
    instructionIdx: number;
    mint: string;
    traderPublicKey: string;
    bondingCurveKey: string;
    vTokensInBondingCurve: number;
    vSolInBondingCurve: number;
    price: string;
    marketCapSol: number;
    totalSupply: number;
    name: string;
    symbol: string;
    image: string;
    uri: string;
    website?: string;
    twitter?: string;
    telegram?: string;
    createdAt: Date;
    dataSource: string;
};


export type TokenTradeTxResult = {
    txType: 'sell' | 'buy';
    signature: string;
    instructionIdx: number;
    mint: string;
    traderPublicKey: string;
    tokenAmount: number;
    solAmount: number;
    tokenPostBalance?: number;
    bondingCurveKey: string;
    vTokensInBondingCurve: number;
    vSolInBondingCurve: number;
    price: string;
    marketCapSol: number;
    timestamp: Date;
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

                const onNewToken = (newTokenData: CreateTokenTxResult, tradeTokenData?: TokenTradeTxResult) => {
                    this.handleNewToken(dataSource, newTokenData, tradeTokenData);
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



    private async handleNewToken(dataSource: ServiceAbstract, newTokenData: CreateTokenTxResult, tradeTokenData?: TokenTradeTxResult) {
        //console.log('DEBUG PumpListener: handleNewToken', newTokenData)

        //this.log(`Mint ${newTokenData.mint} => détécté par ${newTokenData.dataSource}`);

        // TODO: dédoublonner/filtrer les requetes recues (par plusieurs sources)

        const token: Token = this.createTokenFromTxResult(newTokenData, tradeTokenData);
        this.emit('new_token_received', token, tradeTokenData);

        if (tradeTokenData) {
            this.handleNewTrade(dataSource, tradeTokenData);
        }
    }


    private async handleNewTrade(dataSource: ServiceAbstract, tradeTokenData: TokenTradeTxResult) {
        //console.log('DEBUG PumpListener: handleTrade', tradeTokenData)

        //this.log(`Trade ${tradeTokenData.txType} ${tradeTokenData.mint} ${tradeTokenData.solAmount.toFixed(3)} SOL => détécté par ${tradeTokenData.dataSource}`);

        // TODO: dédoublonner/filtrer les requetes recues (par plusieurs sources)

        const trade: Trade = this.createTradeFromTxResult(tradeTokenData);

        this.emit('new_trade_received', trade);
    }


    /** Formatte un Token recu par le DataSource, au format exploitable par TokenManager */
    private createTokenFromTxResult(newTokenData: CreateTokenTxResult, tradeTokenData?: TokenTradeTxResult): Token {
        const solPrice: number = this.priceFeed.getSolPrice();

        const price = (newTokenData.vSolInBondingCurve / newTokenData.vTokensInBondingCurve);
        const marketCapSOL = newTokenData.marketCapSol;
        const marketCapUSD = newTokenData.marketCapSol * solPrice;
        const totalSupply = newTokenData.totalSupply;

        const devBuy = 0; //tradeTokenData?.solAmount ?? 0;
        const devBuyAmount = tradeTokenData?.tokenAmount ?? 0;
        const devPercentage = 100 * devBuyAmount / totalSupply;
        const curvePercentage = 100 - devPercentage;
        const curveAmount = totalSupply - devBuyAmount;

        //const holders: TokenHolder[] = devBuy ? [
        //    {
        //        address: newTokenData.traderPublicKey,
        //        firstBuy: new Date,
        //        lastUpdate: new Date,
        //        percentage: devPercentage,
        //        tokenBalance: devBuyAmount,
        //        tradesCount: 1,
        //        tokenBalanceMax: devBuyAmount,
        //        type: 'dev',
        //    }
        //] : [];


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
            createdAt: new Date(), // TODO: récupérer la date réelle on-chain
            totalSupply,
            marketCapSOL,
            marketCapUSD,
            price: price.toFixed(10),
            trades: [],
            holders: [],
            boundingCurve: {
                address: newTokenData.bondingCurveKey,
                percentage: curvePercentage,
                tokenAmount: curveAmount,
                solAmount: devBuy,
                completed: false,
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
                devBalanceMin: devBuyAmount || null,
                devBalanceMax: devBuyAmount || null,
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

