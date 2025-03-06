// trend-analyzer.ts

import { appConfig } from '../env';
import { Token, TokenTrend, Trade } from '../models/Token.model';


type TrendWindows = Record<string, TokenTrend | undefined>;


/**
 * Analyseur spécialisé dans la détection et l'analyse des tendances sur différentes fenêtres temporelles
 */
export class TrendAnalyzer {
    public updateTrends(
        token: Token,
        existingTrends: TrendWindows,
        trade: Trade
    ): TrendWindows {
        const updatedTrends: TrendWindows = { ...existingTrends };
        const now = new Date();

        // TODO: analyse de l'evolution du nombre de holders, pour chaque window

        // Pour chaque type de fenêtre, mettre à jour la tendance
        for (const [windowName, duration] of Object.entries(appConfig.analysis.trendsWindows)) {
            const windowType = windowName as 'ULTRA_SHORT' | 'VERY_SHORT' | 'SHORT' | 'MEDIUM';

            // Mise à jour des tendances pour cette fenêtre
            updatedTrends[windowType] = this.updateWindowTrend(
                existingTrends[windowType],
                token,
                windowType,
                duration,
                trade,
                now
            );

            // Affichage optionnel des alertes pour cette tendance
            if (0) {
                this.displayTrendAlert(updatedTrends[windowType], token.address);
            }
        }

        // Analyse des corrélations entre fenêtres et affichage optionnel
        if (0) {
            this.displayCorrelatedTrendsAlerts(updatedTrends, token.address);
        }

        return updatedTrends;
    }


    private updateWindowTrend(
        existingTrend: TokenTrend | undefined,
        token: Token,
        windowType: 'ULTRA_SHORT' | 'VERY_SHORT' | 'SHORT' | 'MEDIUM',
        duration: number,
        trade: Trade,
        now: Date
    ): TokenTrend {
        // Calculer la fenêtre temporelle
        const windowStart = new Date(now.getTime() - duration);

        // Calculer le nombre de holders actuel
        const holdersCount = token?.holders.length || 0;

        // Trouver le dev (créateur) parmi les holders
        const devHolder = token?.holders.find(h => h.address === token.creator);
        const devBalance = devHolder?.tokenBalance || null;


        // Créer ou récupérer une tendance
        let trend = existingTrend;

        if (!trend || trend.window.end < windowStart) {
            // Initialiser une nouvelle tendance
            trend = {
                tokenAddress: token.address,
                windowType,
                window: {
                    start: now,
                    end: new Date(now.getTime() + duration),
                },
                trades: {
                    buyCount: 0,
                    sellCount: 0,
                    buyVolume: 0,
                    sellVolume: 0,
                },
                marketCap: {
                    start: trade.marketCapUSD,
                    end: trade.marketCapUSD,
                    change: 0,
                },
                kpis: {
                    priceMin: trade.price,
                    priceMax: trade.price,
                    marketCapUSDMin: trade.marketCapUSD,
                    marketCapUSDMax: trade.marketCapUSD,
                    holdersMin: holdersCount,
                    holdersMax: holdersCount,
                    devBalanceMin: devBalance,
                    devBalanceMax: devBalance,
                },
            };
        } else {
            // Mettre à jour les KPIs
            if (Number(trade.price) < Number(trend.kpis.priceMin)) {
                trend.kpis.priceMin = trade.price;
            }
            if (Number(trade.price) > Number(trend.kpis.priceMax)) {
                trend.kpis.priceMax = trade.price;
            }

            if (trade.marketCapUSD < trend.kpis.marketCapUSDMin) {
                trend.kpis.marketCapUSDMin = trade.marketCapUSD;
            }
            if (trade.marketCapUSD > trend.kpis.marketCapUSDMax) {
                trend.kpis.marketCapUSDMax = trade.marketCapUSD;
            }

            if (holdersCount < trend.kpis.holdersMin) {
                trend.kpis.holdersMin = holdersCount;
            }
            if (holdersCount > trend.kpis.holdersMax) {
                trend.kpis.holdersMax = holdersCount;
            }

            if (devBalance !== null) {
                if (trend.kpis.devBalanceMin === null || devBalance < trend.kpis.devBalanceMin) {
                    trend.kpis.devBalanceMin = devBalance;
                }
                if (trend.kpis.devBalanceMax === null || devBalance > trend.kpis.devBalanceMax) {
                    trend.kpis.devBalanceMax = devBalance;
                }
            }
        }

        // Mise à jour des statistiques
        if (trade.type === 'buy' || trade.type === 'create') {
            trend.trades.buyCount++;
            trend.trades.buyVolume += trade.solAmount;
        } else {
            trend.trades.sellCount++;
            trend.trades.sellVolume += trade.solAmount;
        }

        // Mise à jour du marketCap
        trend.marketCap.end = trade.marketCapUSD;
        if (trend.marketCap.start > 0) {
            trend.marketCap.change = ((trade.marketCapUSD - trend.marketCap.start) / trend.marketCap.start) * 100;
        }

        return trend;
    }


    /** Affiche des alertes pour une tendance spécifique */
    private displayTrendAlert(trend: TokenTrend | undefined, tokenAddress: string): void {
        if (!trend) return;

        // Calculer les métriques
        const netVolume = trend.trades.buyVolume - trend.trades.sellVolume;
        const totalVolume = trend.trades.buyVolume + trend.trades.sellVolume;
        const volumePressure = totalVolume > 0 ? (netVolume / totalVolume) * 100 : 0;

        // Durée de la fenêtre en secondes
        const windowDuration = appConfig.analysis.trendsWindows[trend.windowType] / 1000;

        // Alerte pour mouvement brusque
        if (['ULTRA_SHORT', 'VERY_SHORT'].includes(trend.windowType) && Math.abs(volumePressure) > 80) {
            console.log(`⚠️ MOUVEMENT BRUSQUE sur ${tokenAddress} :`);
            console.log(`   ${volumePressure > 0 ? 'ACHAT' : 'VENTE'} massif(ve) détecté(e)`);
            console.log(`   Volume: ${totalVolume.toFixed(2)} SOL en ${windowDuration} secondes`);
        }

        // Alerte pour variation importante
        if (trend.windowType === 'VERY_SHORT' && Math.abs(trend.marketCap.change) > 15) {
            console.log(`⚠️ VARIATION RAPIDE du prix sur ${tokenAddress} :`);
            console.log(`   ${trend.marketCap.change > 0 ? '📈' : '📉'} ${trend.marketCap.change.toFixed(1)}% en ${windowDuration} secondes`);
        }
    }


    /** Affiche des alertes basées sur la corrélation entre fenêtres */
    private displayCorrelatedTrendsAlerts(trends: TrendWindows, tokenAddress: string): void {
        // Si pas assez de données, sortir
        if (!trends.ULTRA_SHORT || !trends.VERY_SHORT) return;

        // Récupérer les durées des fenêtres pour l'affichage
        const d1 = Math.round(appConfig.analysis.trendsWindows['ULTRA_SHORT'] / 1000 / 10) * 10;
        const d2 = Math.round(appConfig.analysis.trendsWindows['VERY_SHORT'] / 1000 / 10) * 10;

        // Pressions de volume
        const ultraShortPressure = this.calculatePressure(trends.ULTRA_SHORT);
        const veryShortPressure = this.calculatePressure(trends.VERY_SHORT);


        // Détection de dump
        if (ultraShortPressure < -70 && veryShortPressure < -40) {
            console.log(`🚨 DUMP DÉTECTÉ sur ${tokenAddress} !`);
            console.log(`   Pression de vente: ${ultraShortPressure.toFixed(1)}% (${d1}s), ${veryShortPressure.toFixed(1)}% (${d2}s)`);

            if (trends.ULTRA_SHORT) {
                console.log(`   Volume de vente: ${trends.ULTRA_SHORT.trades.sellVolume.toFixed(2)} SOL en ${d1}s`);
            }
        }


        // Autres détections similaires...
    }


    /** Calcule la pression acheteuse/vendeuse d'une tendance */
    private calculatePressure(trend?: TokenTrend): number {
        if (!trend) return 0;

        const netVolume = trend.trades.buyVolume - trend.trades.sellVolume;
        const totalVolume = trend.trades.buyVolume + trend.trades.sellVolume;
        return totalVolume > 0 ? (netVolume / totalVolume) * 100 : 0;
    }

}
