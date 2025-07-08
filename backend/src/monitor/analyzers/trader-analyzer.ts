// trader-analyzer.ts

import { Trade } from "../models/Token.model";


/* ######################################################### */

export interface TokenPosition {
    tokenAddress: string;
    buyPrices: { amount: number; price: string; }[];  // Montants et prix des achats en attente
    totalBuyAmount: number;
    averageBuyPrice: string;
}

type TraderPerformance = any;


// NOTE: actuellement non intégré à PumpMonitor. Pourra être utilisé pour la détection de whale et wallets profitables

const getTraderByAddress = (traderAddress: string): any => null;
const getTraderTrades = (traderAddress: string): Trade[] => [];


/* ######################################################### */

export class TraderAnalyzer {
    private positions = new Map<string, Map<string, TokenPosition>>();  // trader -> token -> position


    // Dans TraderAnalyzer

    async updateTraderPerformance(traderAddress: string): Promise<void> {
        const trader = getTraderByAddress(traderAddress);
        if (!trader) return;


        // Clone les trades pour pouvoir les modifier avec les profits
        const trades: Trade[] = getTraderTrades(traderAddress)
            .sort((a, b) =>
                a.timestamp.getTime() - b.timestamp.getTime() // Traiter les trades dans l'ordre chronologique
            );

        if (!trades || trades.length === 0) return;


        // Calculer les profits de chaque trade
        let totalProfit = 0;
        let profitableTrades = 0;
        let holdTimes: number[] = [];


        // Calculer le profit de chaque trade
        trades.forEach(trade => {
            const profit = this.updatePosition(traderAddress, trade);

            if (profit !== undefined) {  // C'est une vente avec un profit/perte
                totalProfit += profit;

                if (profit > 0) profitableTrades++;

                // Mettre à jour le trade avec le profit calculé
                //trade.profit = profit;
            }
        });


        // Calculer les performances globales
        const tradesCount = trades.length;
        const successRate = tradesCount > 0 ? (profitableTrades / tradesCount) * 100 : 0;

        const performance: TraderPerformance = {
            tradesCount,
            totalProfit,
            successRate,
            avgHoldTime: this.calculateAverageHoldTime(trades),
            lastUpdate: new Date()
        };

        trader.performance = performance;

        if (Math.abs(totalProfit) > 0.1) {  // Afficher seulement si profit/perte significatif
            console.log(`👤 Trader ${traderAddress}:`);
            console.log(`   Profit: ${totalProfit.toFixed(3)} SOL`);
            console.log(`   Taux de succès: ${performance.successRate.toFixed(1)}%`);
            console.log(`   Temps moyen de détention: ${performance.avgHoldTime.toFixed(1)} minutes`);
        }
    }


    /** Calcule du temps de détention moyen des tokens (d'un trader) */
    private calculateAverageHoldTime(trades: Trade[]): number {
        const holdTimes: number[] = [];
        const tokenTrades = new Map<string, Trade[]>();

        // Grouper par token
        trades.forEach(trade => {
            const trades_: Trade[] = tokenTrades.get(trade.tokenAddress) || [];
            trades_.push(trade);

            tokenTrades.set(trade.tokenAddress, trades_);
        });

        // Calculer temps de détention pour chaque pair buy/sell
        tokenTrades.forEach(trades => {
            let lastBuy: Trade | null = null;

            trades.forEach(trade => {
                if (trade.type === 'buy') {
                    lastBuy = trade;

                } else if (trade.type === 'sell' && lastBuy) {
                    const holdTime = (trade.timestamp.getTime() - lastBuy.timestamp.getTime()) / (1000 * 60); // en minutes
                    holdTimes.push(holdTime);
                    lastBuy = null;
                }
            });
        });

        return holdTimes.length > 0
            ? holdTimes.reduce((sum, time) => sum + time, 0) / holdTimes.length
            : 0;
    }


    private updatePosition(traderAddress: string, trade: Trade): number | undefined {
        const traderPositions = this.positions.get(traderAddress) || new Map();
        let position: TokenPosition = traderPositions.get(trade.tokenAddress);

        if (!position) {
            position = {
                tokenAddress: trade.tokenAddress,
                buyPrices: [],
                totalBuyAmount: 0,
                averageBuyPrice: '0'
            };
        }

        if (trade.type === 'buy') {
            position.buyPrices.push({
                amount: trade.tokenAmount,
                price: trade.price
            });

            position.totalBuyAmount += trade.tokenAmount;

            position.averageBuyPrice = (
                position.buyPrices.reduce((sum, buy) =>
                sum + (buy.amount * Number(buy.price)), 0) / position.totalBuyAmount
            ).toFixed(10)

            return undefined;  // Pas de profit sur un achat

        } else {  // sell
            if (position.totalBuyAmount === 0) return undefined;  // Pas d'achat précédent

            const profit = (Number(trade.price) - Number(position.averageBuyPrice)) * trade.tokenAmount;

            // Mettre à jour la position
            position.totalBuyAmount -= trade.tokenAmount;
            if (position.totalBuyAmount <= 0) {
                position.buyPrices = [];
                position.totalBuyAmount = 0;
                position.averageBuyPrice = '0';
            }

            return profit;
        }
    }
}

