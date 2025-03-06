// risk-analyzer.ts

import { Token, Trade } from "../models/Token.model";
import { Severity } from "../models/TokenAnalysis.model";



/* ######################################################### */


/**
 * Analyse de risque (détection de rug pull)
 */
export interface RiskAnalysis {
    score: number;                 // 0-100
    redFlags: RiskFlag[];
    rugPullProbability: number;    // 0-100
}


/**
 * Indicateur de risque détecté
 */
export interface RiskFlag {
    type: string;                // "GROWTH_SPEED", "SELLING_PRESSURE", etc.
    severity: Severity;
    description: string;
    detectedAt: Date;
}


/* ######################################################### */

export class RiskAnalyzer {

    /**
     * Met à jour l'analyse de risque d'un token après un trade
     * @param existingRiskAnalysis L'analyse de risque existante
     * @param token Le token à analyser
     * @param trade Le dernier trade effectué
     * @param recentTrades Les trades récents pour ce token
     * @returns L'analyse de risque mise à jour
     */
    public updateRiskAnalysis(
        existingRiskAnalysis: RiskAnalysis,
        token: Token,
        trade: Trade,
        recentTrades: Trade[]
    ): RiskAnalysis {
        // Cloner l'analyse existante pour éviter de modifier l'original
        const updatedAnalysis: RiskAnalysis = {
            score: existingRiskAnalysis.score,
            redFlags: [...existingRiskAnalysis.redFlags],
            rugPullProbability: existingRiskAnalysis.rugPullProbability
        };

        // Ajouter le trade courant aux trades récents pour analyse
        const allTrades = [...recentTrades, trade];

        // Analyser les différents patterns de risque
        this.analyzeGrowthEvolution(updatedAnalysis, token, allTrades);
        this.analyzeGrowthAnomalies(updatedAnalysis, token, allTrades);
        this.analyzeSellingPressure(updatedAnalysis, allTrades);
        this.analyzePriceManipulation(updatedAnalysis, allTrades);
        this.analyzeHolderDistribution(updatedAnalysis, token);
        this.analyzeCreatorBehavior(updatedAnalysis, token, allTrades);

        // Calculer la probabilité de rug pull basée sur les patterns détectés
        updatedAnalysis.rugPullProbability = this.calculateRugPullProbability(updatedAnalysis);

        // Recalculer le score de risque global
        updatedAnalysis.score = this.calculateRiskScore(updatedAnalysis.redFlags);

        // Affichage optionnel des alertes de risque
        if (0) {
            this.displayRiskAlerts(updatedAnalysis, token);
        }

        return updatedAnalysis;
    }


    private analyzeGrowthEvolution(
        analysis: RiskAnalysis,
        token: Token,
        trades: Trade[]
    ): void {
        const lastTradeAge = (Date.now() - token.lastUpdated.getTime()) / 1000; // en secondes

        if (lastTradeAge > 20) {
            this.addRedFlag(analysis, {
                type: 'GROWTH_EVOLUTION',
                severity: 'HIGH',
                description: `Aucun trade détécté depuis ${lastTradeAge.toFixed(0)} secondes`,
                detectedAt: new Date(),
            });

        } else if (lastTradeAge > 10) {
            this.addRedFlag(analysis, {
                type: 'GROWTH_EVOLUTION',
                severity: 'MEDIUM',
                description: `Aucun trade détécté depuis ${lastTradeAge.toFixed(0)} secondes`,
                detectedAt: new Date(),
            });

        } else if (lastTradeAge > 5) {
            this.addRedFlag(analysis, {
                type: 'GROWTH_EVOLUTION',
                severity: 'LOW',
                description: `Aucun trade détécté depuis ${lastTradeAge.toFixed(0)} secondes`,
                detectedAt: new Date(),
            });
        }
    }


    /**
     * Détecte les anomalies de croissance (croissance trop rapide, artificielle)
     */
    private analyzeGrowthAnomalies(
        analysis: RiskAnalysis,
        token: Token,
        trades: Trade[]
    ): void {
        if (trades.length < 5) return; // Pas assez de données

        const creationTime = token.createdAt.getTime();
        const now = new Date().getTime();

        // Temps écoulé depuis la création (en secondes)
        const elapsedTimeSec = (now - creationTime) / 1000;

        // Vérifier si la marketCap a augmenté trop rapidement
        if (elapsedTimeSec < 30 && token.marketCapUSD > 10_000) {
            this.addRedFlag(analysis, {
                type: 'GROWTH_SPEED',
                severity: 'HIGH',
                description: `Croissance anormalement rapide: $${Math.round(token.marketCapUSD)} en ${Math.round(elapsedTimeSec)} secondes`,
                detectedAt: new Date(),
            });

        } else if (elapsedTimeSec < 60 && token.marketCapUSD > 30_000) {
            this.addRedFlag(analysis, {
                type: 'GROWTH_SPEED',
                severity: 'HIGH',
                description: `Croissance anormalement rapide: $${Math.round(token.marketCapUSD)} en ${Math.round(elapsedTimeSec)} secondes`,
                detectedAt: new Date(),
            });

        } else {
            //this.removeRedFlag(analysis, 'GROWTH_SPEED');
        }


        // Vérifier les pics de prix anormaux
        const prices = trades.map(t => t.price).map(Number);
        const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        const maxPrice = Math.max(...prices);

        if (maxPrice > avgPrice * 3 && trades.length > 10) {
            this.addRedFlag(analysis, {
                type: 'PRICE_SPIKE',
                severity: 'MEDIUM',
                description: `Pic de prix anormal: ${maxPrice.toFixed(6)} SOL (${Math.round((maxPrice / avgPrice - 1) * 100)}% > moyenne)`,
                detectedAt: new Date()
            });

        } else {
            //this.removeRedFlag(analysis, 'PRICE_SPIKE');
        }
    }

    /**
     * Détecte les pressions de vente (multiples ventes rapides)
     */
    private analyzeSellingPressure(
        analysis: RiskAnalysis,
        trades: Trade[]
    ): void {
        if (trades.length < 10) return; // Pas assez de données

        // Analyser les 10 derniers trades
        const recentTrades = trades.slice(-10);
        const sellCount = recentTrades.filter(t => t.type === 'sell').length;
        const sellRatio = sellCount / recentTrades.length;

        // Vérifier s'il y a une pression de vente forte
        if (sellRatio > 0.7 && sellCount >= 5) {
            this.addRedFlag(analysis, {
                type: 'SELLING_PRESSURE',
                severity: 'HIGH',
                description: `Forte pression de vente: ${Math.round(sellRatio * 100)}% des 10 derniers trades sont des ventes`,
                detectedAt: new Date()
            });

        } else if (sellRatio > 0.5 && sellCount >= 3) {
            this.addRedFlag(analysis, {
                type: 'SELLING_PRESSURE',
                severity: 'MEDIUM',
                description: `Pression de vente modérée: ${Math.round(sellRatio * 100)}% des 10 derniers trades sont des ventes`,
                detectedAt: new Date()
            });

        } else {
            this.removeRedFlag(analysis, 'SELLING_PRESSURE');
        }


        // Vérifier les ventes massives (grands volumes)
        if (recentTrades.length > 0) {
            const sellVolumes = recentTrades
                .filter(t => t.type === 'sell')
                .map(t => t.solAmount);

            if (sellVolumes.length > 0) {
                const avgSellVolume = sellVolumes.reduce((sum, vol) => sum + vol, 0) / sellVolumes.length;
                const largeSells = sellVolumes.filter(vol => vol > avgSellVolume * 3);

                if (largeSells.length >= 2) {
                    this.addRedFlag(analysis, {
                        type: 'LARGE_SELLS',
                        severity: 'HIGH',
                        description: `${largeSells.length} ventes massives détectées (>3x volume moyen)`,
                        detectedAt: new Date()
                    });
                }

            } else {
                this.removeRedFlag(analysis, 'LARGE_SELLS');
            }
        }
    }

    /**
     * Détecte les manipulations de prix potentielles
     */
    private analyzePriceManipulation(
        analysis: RiskAnalysis,
        trades: Trade[]
    ): void {
        if (trades.length < 15) return; // Pas assez de données

        // Détecter les baisses consécutives de prix
        let consecutivePriceDrops = 0;
        let maxDropPercentage = 0;

        for (let i = 1; i < trades.length; i++) {
            const priceDrop = (Number(trades[i].price) - Number(trades[i - 1].price)) / Number(trades[i - 1].price);

            if (priceDrop < -0.05) { // Baisse de plus de 5%
                consecutivePriceDrops++;
                maxDropPercentage = Math.min(maxDropPercentage, priceDrop);

            } else {
                consecutivePriceDrops = 0;
            }

            // Alerte si 3+ baisses consécutives ou une baisse très forte
            if (consecutivePriceDrops >= 5) {
                this.addRedFlag(analysis, {
                    type: 'CONSECUTIVE_DROPS',
                    severity: 'HIGH',
                    description: `${consecutivePriceDrops} baisses de prix consécutives`,
                    detectedAt: new Date()
                });
                break;

            } else if (consecutivePriceDrops >= 3) {
                this.addRedFlag(analysis, {
                    type: 'CONSECUTIVE_DROPS',
                    severity: 'MEDIUM',
                    description: `${consecutivePriceDrops} baisses de prix consécutives`,
                    detectedAt: new Date()
                });
                break;
            }

            if (priceDrop < -0.30) { // Chute de plus de 30%
                this.addRedFlag(analysis, {
                    type: 'MAJOR_PRICE_DROP',
                    severity: 'HIGH',
                    description: `Chute majeure de prix: ${Math.round(priceDrop * 100)}%`,
                    detectedAt: new Date()
                });
                break;

            } else if (priceDrop < -0.15) { // Chute de plus de 15%
                this.addRedFlag(analysis, {
                    type: 'MAJOR_PRICE_DROP',
                    severity: 'MEDIUM',
                    description: `Chute majeure de prix: ${Math.round(priceDrop * 100)}%`,
                    detectedAt: new Date()
                });
                break;
            }
        }

        // Détecter les patterns de pump and dump
        const windowSize = 10; // Analyser par fenêtres de 10 trades
        if (trades.length >= windowSize * 2) {
            const firstWindow = trades.slice(0, windowSize);
            const lastWindow = trades.slice(-windowSize);

            const firstAvgPrice = firstWindow.reduce((sum, t) => sum + Number(t.price), 0) / windowSize;
            const lastAvgPrice = lastWindow.reduce((sum, t) => sum + Number(t.price), 0) / windowSize;
            const priceChange = (lastAvgPrice - firstAvgPrice) / firstAvgPrice;

            // Si le prix a d'abord monté puis chuté significativement
            if (priceChange < -0.5) { // Chute de plus de 50%
                const peak = Math.max(...trades.map(t => Number(t.price)));
                const peakChange = (peak - firstAvgPrice) / firstAvgPrice;

                if (peakChange > 1.0) { // Si le prix a au moins doublé avant de chuter
                    this.addRedFlag(analysis, {
                        type: 'PUMP_AND_DUMP',
                        severity: 'HIGH',
                        description: `Pattern pump & dump détecté: +${Math.round(peakChange * 100)}% puis ${Math.round(priceChange * 100)}%`,
                        detectedAt: new Date()
                    });
                }

            } else if (priceChange < -0.3) { // Chute de plus de 30%
                const peak = Math.max(...trades.map(t => Number(t.price)));
                const peakChange = (peak - firstAvgPrice) / firstAvgPrice;

                if (peakChange > 0.5) { // Si le prix a pris au moins 50% avant de chuter
                    this.addRedFlag(analysis, {
                        type: 'PUMP_AND_DUMP',
                        severity: 'MEDIUM',
                        description: `Pattern pump & dump détecté: +${Math.round(peakChange * 100)}% puis ${Math.round(priceChange * 100)}%`,
                        detectedAt: new Date()
                    });
                }
            }
        }
    }

    /**
     * Analyse la distribution des holders (concentration, etc.)
     */
    private analyzeHolderDistribution(
        analysis: RiskAnalysis,
        token: Token
    ): void {
        const holders = token.holders;
        if (!holders || holders.length === 0) return;

        // Calculer la concentration des tokens
        // Exclure la bonding curve pour cette analyse
        const tradingHolders = holders.filter(h => h.type !== 'bondingCurve');

        if (tradingHolders.length > 0) {
            // Vérifier si les tokens sont très concentrés
            const topHolder = tradingHolders.sort((a, b) => b.percentage - a.percentage)[0];

            // TODO: ajouter une severity MEDIUM si top3Holders ont plus de 50%

            if (topHolder && topHolder.percentage > 40 && topHolder.type === 'trader') {
                this.addRedFlag(analysis, {
                    type: 'CONCENTRATED_OWNERSHIP',
                    severity: 'HIGH',
                    description: `Un seul trader détient ${Math.round(topHolder.percentage)}% des tokens`,
                    detectedAt: new Date()
                });

            } else if (topHolder && topHolder.percentage > 10 && topHolder.type === 'trader') {
                this.addRedFlag(analysis, {
                    type: 'CONCENTRATED_OWNERSHIP',
                    severity: 'MEDIUM',
                    description: `Un seul trader détient ${Math.round(topHolder.percentage)}% des tokens`,
                    detectedAt: new Date()
                });

            } else {
                this.removeRedFlag(analysis, 'CONCENTRATED_OWNERSHIP');
            }


            // Vérifier si le créateur détient beaucoup de tokens
            const creator = holders.find(h => h.type === 'dev');

            if (creator && creator.percentage > 5) {
                this.addRedFlag(analysis, {
                    type: 'LARGE_DEV_HOLDINGS',
                    severity: 'HIGH',
                    description: `Le créateur détient ${Math.round(creator.percentage)}% des tokens`,
                    detectedAt: new Date()
                });

            } else if (creator && creator.percentage > 2) {
                this.addRedFlag(analysis, {
                    type: 'LARGE_DEV_HOLDINGS',
                    severity: 'MEDIUM',
                    description: `Le créateur détient ${Math.round(creator.percentage)}% des tokens`,
                    detectedAt: new Date()
                });

            } else if (creator && creator.percentage > 1) {
                this.addRedFlag(analysis, {
                    type: 'LARGE_DEV_HOLDINGS',
                    severity: 'LOW',
                    description: `Le créateur détient ${Math.round(creator.percentage)}% des tokens`,
                    detectedAt: new Date()
                });

            } else {
                this.removeRedFlag(analysis, 'LARGE_DEV_HOLDINGS');
            }

            this.removeRedFlag(analysis, 'FEW_HOLDERS');

        } else {
            this.addRedFlag(analysis, {
                type: 'FEW_HOLDERS',
                severity: 'HIGH',
                description: `Aucun holder`,
                detectedAt: new Date()
            });
        }
    }

    /**
     * Analyse le comportement du créateur du token
     */
    private analyzeCreatorBehavior(
        analysis: RiskAnalysis,
        token: Token,
        trades: Trade[]
    ): void {
        // Isoler les trades du créateur
        const creatorTrades = trades.filter(t => t.traderAddress === token.creator);
        if (creatorTrades.length === 0) return;

        // Vérifier si le créateur a commencé à vendre rapidement
        const creatorSells = creatorTrades.filter(t => t.type === 'sell');
        if (creatorSells.length > 0) {
            const firstSellTime = Math.min(...creatorSells.map(t => t.timestamp.getTime()));
            const timeSinceCreationSec = (firstSellTime - token.createdAt.getTime()) / 1000; // en secondes
            const timeSinceCreation = timeSinceCreationSec / 60; // en minutes

            if (timeSinceCreation < 1) {
                this.addRedFlag(analysis, {
                    type: 'EARLY_CREATOR_SELLING',
                    severity: 'HIGH',
                    description: `Le créateur a commencé à vendre après seulement ${Math.round(timeSinceCreationSec)} secondes`,
                    detectedAt: new Date()
                });

            } else if (timeSinceCreation < 5) {
                this.addRedFlag(analysis, {
                    type: 'EARLY_CREATOR_SELLING',
                    severity: 'MEDIUM',
                    description: `Le créateur a commencé à vendre après seulement ${Math.round(timeSinceCreation)} minutes`,
                    detectedAt: new Date()
                });
            }


            // Vérifier si le créateur a vendu une grande proportion
            if (creatorSells.length >= 3) {
                const totalSellVolume = creatorSells.reduce((sum, t) => sum + t.tokenAmount, 0);

                //const totalCreatorTokens = token.holders.find(holder => holder.address === token.creator)?.tokenBalance ?? 0; // faux car a chaque trade le hold diminue et fausse les calculs futurs
                const totalCreatorTokens = creatorTrades.filter(trade => trade.type === 'buy').reduce((p,c) => p + c.tokenAmount, 0);

                if (totalSellVolume > totalCreatorTokens * 0.7) {
                    this.addRedFlag(analysis, {
                        type: 'MASSIVE_CREATOR_SELLING',
                        severity: 'HIGH',
                        description: `Le créateur a vendu une grande partie de ses tokens (${creatorSells.length} ventes)`,
                        detectedAt: new Date()
                    });

                } else if (totalSellVolume > totalCreatorTokens * 0.5) {
                    this.addRedFlag(analysis, {
                        type: 'MASSIVE_CREATOR_SELLING',
                        severity: 'MEDIUM',
                        description: `Le créateur a vendu la majorité de ses tokens (${creatorSells.length} ventes)`,
                        detectedAt: new Date()
                    });

                }
            }
        }
    }

    /**
     * Ajoute un drapeau rouge à l'analyse si ce type n'existe pas déjà
     */
    private addRedFlag(analysis: RiskAnalysis, flag: RiskFlag): void {
        // Vérifier si ce type exact de drapeau existe déjà
        const existingFlagIndex = analysis.redFlags.findIndex(
            f => f.type === flag.type /* && f.severity === flag.severity */
        );

        if (existingFlagIndex === -1) {
            // Ajouter le nouveau drapeau
            analysis.redFlags.push(flag);

        } else {
            // Mettre à jour le drapeau existant
            analysis.redFlags[existingFlagIndex] = {
                ...flag,
                // Conserver la date de détection originale
                detectedAt: analysis.redFlags[existingFlagIndex].detectedAt
            };
        }
    }


    private removeRedFlag(analysis: RiskAnalysis, flagType: string) {
        // Vérifier si un indicateur similaire existe déjà
        const existingIndex = analysis.redFlags.findIndex(
            i => i.type === flagType
        );

        if (existingIndex != -1) {
            // Supprimer le flag
            analysis.redFlags = analysis.redFlags.filter(flag => flag.type !== flagType);
        }
    }


    /**
     * Calcule le score de risque global basé sur les drapeaux rouges
     * @returns Score de risque entre 0 et 100
     */
    private calculateRiskScore(redFlags: RiskFlag[]): number {
        if (redFlags.length === 0) return 0;

        // Poids par sévérité
        const severityWeights = {
            'HIGH': 25,
            'MEDIUM': 15,
            'LOW': 5
        };

        // Calculer le score en fonction des drapeaux
        let score = 0;

        redFlags.forEach(flag => {
            score += severityWeights[flag.severity];
        });

        // Limiter le score à 100
        return Math.min(100, score);
    }

    /**
     * Calcule la probabilité de rug pull basée sur divers facteurs
     * @returns Probabilité entre 0 et 100
     */
    private calculateRugPullProbability(analysis: RiskAnalysis): number {
        // Si pas de drapeaux à risque élevé, la probabilité est limitée
        const hasHighRiskFlags = analysis.redFlags.some(flag => flag.severity === 'HIGH');

        if (!hasHighRiskFlags) {
            return Math.min(60, analysis.score); // Maximum 60% sans drapeaux à risque élevé
        }

        // Facteurs aggravants spécifiques
        const hasCreatorSelling = analysis.redFlags.some(flag => flag.type.includes('CREATOR_SELLING'));
        const hasPriceManipulation = analysis.redFlags.some(flag =>
            flag.type === 'PUMP_AND_DUMP' ||
            flag.type === 'MAJOR_PRICE_DROP'
        );

        // Ajouter des bonus pour des combinaisons particulièrement risquées
        let probability = analysis.score;

        if (hasCreatorSelling && hasPriceManipulation) {
            probability += 20; // +20% si le créateur vend pendant une manipulation de prix

            this.addRedFlag(analysis, {
                type: 'RUG_PULL',
                severity: 'HIGH',
                description: `Risque important de Rug Pull`,
                detectedAt: new Date(),
            });
        }

        return Math.min(100, probability);
    }

    /**
     * Affiche les alertes de risque sur la console
     */
    private displayRiskAlerts(analysis: RiskAnalysis, token: Token): void {
        // Afficher uniquement si des drapeaux à risque élevé ou score élevé
        const hasHighRisks = analysis.redFlags.some(flag => flag.severity === 'HIGH');

        if (hasHighRisks || analysis.score > 50) {
            console.log(`⚠️ RISQUE DÉTECTÉ pour ${token.symbol} (${token.address})`);
            console.log(`   Score de risque: ${analysis.score}/100`);
            console.log(`   Probabilité de rug pull: ${analysis.rugPullProbability}%`);

            if (analysis.redFlags.length > 0) {
                console.log('   Alertes détectées:');

                const severityEmojis = {
                    'HIGH': '🔴',
                    'MEDIUM': '🟠',
                    'LOW': '🟡'
                };

                analysis.redFlags.forEach(flag => {
                    console.log(`   ${severityEmojis[flag.severity]} ${flag.description}`);
                });
            }
        }
    }

    /**
     * Initialise une analyse de risque vide
     */
    public initializeRiskAnalysis(): RiskAnalysis {
        return {
            score: 0,
            redFlags: [],
            rugPullProbability: 0
        };
    }
}
