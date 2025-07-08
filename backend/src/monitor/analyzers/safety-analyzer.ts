// safety-analyzer.ts

import { Token, Trade } from "../models/Token.model";
import { Severity } from "../models/TokenAnalysis.model";



/* ######################################################### */



/**
 * Analyse de sécurité et de qualité
 */
export interface SafetyAnalysis {
    score: number;                 // 0-100
    indicators: SafetyIndicator[];
}

/**
 * Indicateur de sécurité/qualité
 */
export interface SafetyIndicator {
    type: string;                // "HOLDER_DISTRIBUTION", "TRADING_PATTERN", etc.
    strength: Severity;
    description: string;
    detectedAt: Date;
}


/* ######################################################### */

export class SafetyAnalyzer {

    /**
     * Met à jour l'analyse de sécurité d'un token après un trade
     * @param existingSafetyAnalysis L'analyse de sécurité existante
     * @param token Le token à analyser
     * @param trade Le dernier trade effectué
     * @param recentTrades Les trades récents pour ce token
     * @returns L'analyse de sécurité mise à jour
     */
    public updateSafetyAnalysis(
        existingSafetyAnalysis: SafetyAnalysis,
        token: Token,
        trade: Trade,
        recentTrades: Trade[]
    ): SafetyAnalysis {
        // Cloner l'analyse existante pour éviter de modifier l'original
        const updatedAnalysis: SafetyAnalysis = {
            score: existingSafetyAnalysis.score,
            indicators: [...existingSafetyAnalysis.indicators]
        };

        // Ajouter le trade courant aux trades récents pour analyse
        const allTrades = [...recentTrades, trade];

        // Analyser les différents aspects de sécurité/qualité
        this.analyzeHolderDistribution(updatedAnalysis, token);
        this.analyzeTradingPattern(updatedAnalysis, allTrades);
        this.analyzeTokenLiquidity(updatedAnalysis, token, allTrades);
        this.analyzeGrowthStability(updatedAnalysis, token, allTrades);
        this.analyzeSocialFactors(updatedAnalysis, token);

        // Recalculer le score de sécurité global
        updatedAnalysis.score = this.calculateSafetyScore(updatedAnalysis.indicators);

        // Affichage optionnel des indicateurs de sécurité
        if (0) {
            this.displaySafetyAnalysis(updatedAnalysis, token);
        }

        return updatedAnalysis;
    }

    /**
     * Analyse la distribution des holders (répartition saine)
     */
    private analyzeHolderDistribution(
        analysis: SafetyAnalysis,
        token: Token
    ): void {
        const holders = token.holders;
        if (!holders || holders.length === 0) return;

        // Exclure la bonding curve pour cette analyse
        const tradingHolders = holders.filter(h => h.type !== 'bondingCurve');

        if (tradingHolders.length > 0) {
            // Vérifier le nombre de holders actifs (ceux avec une part significative)
            const activeHolders = tradingHolders.filter(h => h.percentage > 0.1).length;

            // Vérifier la répartition des tokens
            const topHolder = tradingHolders.sort((a, b) => b.percentage - a.percentage)[0];
            const topHolderPercentage = topHolder ? topHolder.percentage : 0;

            // Vérifier la part du créateur
            const creator = holders.find(h => h.type === 'dev');
            const creatorPercentage = creator ? creator.percentage : 0;

            // Distribution très saine
            if (activeHolders >= 5 && topHolderPercentage < 30 && creatorPercentage < 1) {
                this.addSafetyIndicator(analysis, {
                    type: 'HEALTHY_DISTRIBUTION',
                    strength: 'HIGH',
                    description: `Distribution saine: ${activeHolders} holders actifs (${tradingHolders.length} au total), aucun ne détient plus de 30%`
                });

            } else if (activeHolders >= 3 && topHolderPercentage < 40 && creatorPercentage < 5) {
                // Distribution assez saine
                this.addSafetyIndicator(analysis, {
                    type: 'HEALTHY_DISTRIBUTION',
                    strength: 'MEDIUM',
                    description: `Distribution plutôt équilibrée avec ${activeHolders} holders actifs (${tradingHolders.length} au total)`
                });

            } else {
                this.removeSafetyIndicator(analysis, 'HEALTHY_DISTRIBUTION');
            }


            if (tradingHolders.length > 20) {
                // Beaucoup de holders
                this.addSafetyIndicator(analysis, {
                    type: 'MANY_HOLDERS',
                    strength: 'HIGH',
                    description: `${tradingHolders.length} holders au total`
                });

            } else if (tradingHolders.length > 10) {
                // Beaucoup de holders
                this.addSafetyIndicator(analysis, {
                    type: 'MANY_HOLDERS',
                    strength: 'MEDIUM',
                    description: `${tradingHolders.length} holders au total`
                });

            } else {
                this.removeSafetyIndicator(analysis, 'MANY_HOLDERS');
            }
        }
    }

    /**
     * Analyse les patterns de trading (volume, fréquence, etc.)
     */
    private analyzeTradingPattern(
        analysis: SafetyAnalysis,
        trades: Trade[]
    ): void {
        if (trades.length < 10) return; // Pas assez de données

        // Analyser le ratio achat/vente
        const buyCount = trades.filter(t => t.type === 'buy').length;
        const sellCount = trades.filter(t => t.type === 'sell').length;
        const buyRatio = buyCount / trades.length;

        // Analyser le volume moyen des trades
        const avgVolume = trades.reduce((sum, t) => sum + t.solAmount, 0) / trades.length;


        if (trades.length < 10) {
            this.addSafetyIndicator(analysis, {
                type: 'LOW_TRADING',
                strength: 'HIGH',
                description: `Moins de 10 trades detectés`
            });

        } else if (trades.length <= 20) {
            this.addSafetyIndicator(analysis, {
                type: 'LOW_TRADING',
                strength: 'MEDIUM',
                description: `Moins de 20 trades detectés`
            });

        } else {
            this.removeSafetyIndicator(analysis, 'LOW_TRADING');
        }


        // Analyser la fréquence des trades
        if (trades.length >= 10) {
            const timeRange = trades[trades.length - 1].timestamp.getTime() - trades[0].timestamp.getTime();
            //const avgTimeMs = timeRange / (trades.length - 1);
            const tradesPerMinute = trades.length / (timeRange / 60000); // trades par minute

            if (tradesPerMinute > 3 && tradesPerMinute < 20 && avgVolume > 0.1) {
                // Trading régulier et actif
                this.addSafetyIndicator(analysis, {
                    type: 'ACTIVE_TRADING',
                    strength: 'HIGH',
                    description: `Trading actif et régulier: ${tradesPerMinute.toFixed(1)} trades/min`
                });

            } else if (tradesPerMinute > 1 && avgVolume > 0.05) {
                // Trading modéré
                this.addSafetyIndicator(analysis, {
                    type: 'ACTIVE_TRADING',
                    strength: 'MEDIUM',
                    description: `Trading modéré: ${tradesPerMinute.toFixed(1)} trades/min`
                });

            } else {
                this.removeSafetyIndicator(analysis, 'ACTIVE_TRADING');
            }
        }

        // Rapport achat/vente équilibré ou favorable
        if (buyRatio > 0.6 && buyRatio < 0.9 && trades.length > 15) {
            const buyPercent = (buyRatio * 100).toFixed(0);
            this.addSafetyIndicator(analysis, {
                type: 'HEALTHY_BUY_RATIO',
                strength: buyRatio > 0.7 ? 'HIGH' : 'MEDIUM',
                description: `Ratio achat/vente favorable: ${buyPercent}% d'achats`
            });

        } else {
            this.removeSafetyIndicator(analysis, 'HEALTHY_BUY_RATIO');
        }
    }

    /**
     * Analyse la liquidité du token
     */
    private analyzeTokenLiquidity(
        analysis: SafetyAnalysis,
        token: Token,
        trades: Trade[]
    ): void {
        if (trades.length < 5) return; // Pas assez de données

        // Chercher la bonding curve dans les holders
        const bondingCurve = token.holders.find(h => h.type === 'bondingCurve');

        if (bondingCurve) {
            // Vérifier le pourcentage de tokens dans la bonding curve
            const bcPercentage = bondingCurve.percentage;

            // Bonne liquidité si beaucoup de tokens restent dans la bonding curve
            if (bcPercentage > 90) {
                this.addSafetyIndicator(analysis, {
                    type: 'HIGH_LIQUIDITY',
                    strength: 'HIGH',
                    description: `Très bonne liquidité: ${bcPercentage.toFixed(1)}% des tokens dans la bonding curve`
                });

            } else if (bcPercentage > 75) {
                this.addSafetyIndicator(analysis, {
                    type: 'HIGH_LIQUIDITY',
                    strength: 'MEDIUM',
                    description: `Bonne liquidité: ${bcPercentage.toFixed(1)}% des tokens dans la bonding curve`
                });

            } else if (bcPercentage > 50) {
                this.addSafetyIndicator(analysis, {
                    type: 'HIGH_LIQUIDITY',
                    strength: 'MEDIUM',
                    description: `Liquidité moyenne: ${bcPercentage.toFixed(1)}% des tokens dans la bonding curve`
                });

            } else {
                this.removeSafetyIndicator(analysis, 'HIGH_LIQUIDITY');
            }
        }

        // Analyser la liquidité basée sur le volume récent
        const recentTrades = trades.slice(-20);
        const totalVolume = recentTrades.reduce((sum, t) => sum + t.solAmount, 0);

        // Bonne liquidité si volume récent élevé par rapport à la marketCap
        const liquidityRatio = (totalVolume / token.marketCapSOL) * 100;

        if (liquidityRatio > 5 && token.marketCapSOL > 1) {
            this.addSafetyIndicator(analysis, {
                type: 'HIGH_VOLUME',
                strength: liquidityRatio > 10 ? 'HIGH' : 'MEDIUM',
                description: `Volume récent élevé: ${liquidityRatio.toFixed(1)}% de la marketCap`
            });

        } else {
            this.removeSafetyIndicator(analysis, 'HIGH_VOLUME');
        }
    }

    /**
     * Analyse la stabilité de la croissance
     */
    private analyzeGrowthStability(
        analysis: SafetyAnalysis,
        token: Token,
        trades: Trade[]
    ): void {
        if (trades.length < 15) return; // Pas assez de données

        // Analyser la volatilité des prix
        const prices = trades.map(t => t.price);
        const avgPrice = prices.reduce((sum, p) => sum + Number(p), 0) / prices.length;

        // Calculer l'écart-type des prix
        const variance = prices.reduce((sum, p) => sum + Math.pow(Number(p) - avgPrice, 2), 0) / prices.length;
        const stdDev = Math.sqrt(variance);

        // Calculer le coefficient de variation (écart-type relatif)
        const covPrice = (stdDev / avgPrice) * 100;

        // Croissance stable si faible coefficient de variation
        if (covPrice < 15) {
            this.addSafetyIndicator(analysis, {
                type: 'PRICE_STABILITY',
                strength: covPrice < 8 ? 'HIGH' : 'MEDIUM',
                description: `Prix stable: variation relative de ${covPrice.toFixed(1)}%`
            });

        } else {
            this.removeSafetyIndicator(analysis, 'PRICE_STABILITY');
        }


        // Analyser la tendance des prix
        const firstPrice = trades[0].price;
        const lastPrice = trades[trades.length - 1].price;
        const priceGrowth = ((Number(lastPrice) / Number(firstPrice)) - 1) * 100;

        // Croissance saine si positive mais pas excessive

        if (priceGrowth >= 100) {
            this.addSafetyIndicator(analysis, {
                type: 'HEALTHY_GROWTH',
                strength: 'HIGH',
                description: `Croissance explosive: +${priceGrowth.toFixed(1)}% depuis le début`
            });

        } else if (priceGrowth > 50) {
            this.addSafetyIndicator(analysis, {
                type: 'HEALTHY_GROWTH',
                strength: 'HIGH',
                description: `Croissance forte: +${priceGrowth.toFixed(1)}% depuis le début`
            });

        } else if (priceGrowth > 10) {
            this.addSafetyIndicator(analysis, {
                type: 'HEALTHY_GROWTH',
                strength: 'MEDIUM',
                description: `Croissance saine: +${priceGrowth.toFixed(1)}% depuis le début`
            });

        } else if (priceGrowth > 0) {
            this.addSafetyIndicator(analysis, {
                type: 'HEALTHY_GROWTH',
                strength: 'LOW',
                description: `Croissance faible: +${priceGrowth.toFixed(1)}% depuis le début`
            });

        } else {
            this.removeSafetyIndicator(analysis, 'HEALTHY_GROWTH');
        }

    }

    /**
     * Analyse les facteurs sociaux (site web, réseaux sociaux, etc.)
     */
    private analyzeSocialFactors(
        analysis: SafetyAnalysis,
        token: Token
    ): void {
        let socialScore = 0;

        // Vérifier la présence web
        if (token.website) {
            socialScore += 30;

            // Bonus pour les domaines de qualité
            if (token.website.includes('.io') || token.website.includes('.com')) {
                socialScore += 10;
            }
        }

        // Vérifier la présence sur Twitter
        if (token.twitter) {
            socialScore += 25;
        }

        // Vérifier la présence sur Telegram
        if (token.telegram) {
            socialScore += 20;
        }

        // Vérifier la présence d'une image
        if (token.image) {
            socialScore += 15;
        }

        // Ajouter un indicateur selon le score
        if (socialScore >= 70) {
            this.addSafetyIndicator(analysis, {
                type: 'STRONG_SOCIAL_PRESENCE',
                strength: 'HIGH',
                description: 'Forte présence sociale (site web, Twitter, Telegram)'
            });

        } else if (socialScore >= 40) {
            this.addSafetyIndicator(analysis, {
                type: 'DECENT_SOCIAL_PRESENCE',
                strength: 'MEDIUM',
                description: 'Présence sociale modérée'
            });
        }
    }

    /**
     * Ajoute un indicateur de sécurité à l'analyse
     */
    private addSafetyIndicator(analysis: SafetyAnalysis, indicator: Omit<SafetyIndicator, 'detectedAt'>): void {
        // Vérifier si un indicateur similaire existe déjà
        const existingIndex = analysis.indicators.findIndex(
            i => i.type === indicator.type
        );

        const realIndicator = { ...indicator, detectedAt: new Date };

        if (existingIndex === -1) {
            // Ajouter le nouvel indicateur
            analysis.indicators.push(realIndicator);

        } else {
            // Mettre à jour l'indicateur existant si le nouveau est plus fort
            const existing = analysis.indicators[existingIndex];

            const strengthValues = {
                'HIGH': 3,
                'MEDIUM': 2,
                'LOW': 1
            };

            if (strengthValues[indicator.strength] > strengthValues[existing.strength]) {
                analysis.indicators[existingIndex] = realIndicator;
            }
        }
    }


    private removeSafetyIndicator(analysis: SafetyAnalysis, indicatorType: string) {
        // Vérifier si un indicateur similaire existe déjà
        const existingIndex = analysis.indicators.findIndex(
            i => i.type === indicatorType
        );

        if (existingIndex != -1) {
            // Supprime l'indicateur
            analysis.indicators = analysis.indicators.filter(indicator => indicator.type !== indicatorType);
        }
    }


    /**
     * Calcule le score de sécurité global basé sur les indicateurs
     * @returns Score de sécurité entre 0 et 100
     */
    private calculateSafetyScore(indicators: SafetyIndicator[]): number {
        if (indicators.length === 0) return 50; // Score neutre par défaut

        // Poids par force
        const strengthWeights = {
            'HIGH': 20,
            'MEDIUM': 10,
            'LOW': 5
        };

        // Score de base
        let score = 50;

        // Ajouter des points pour chaque indicateur
        indicators.forEach(indicator => {
            score += strengthWeights[indicator.strength];
        });

        // Limiter le score entre 0 et 100
        return Math.min(100, Math.max(0, score));
    }

    /**
     * Affiche l'analyse de sécurité sur la console
     */
    private displaySafetyAnalysis(analysis: SafetyAnalysis, token: Token): void {
        // Afficher uniquement si score intéressant ou plusieurs indicateurs
        if (analysis.score > 60 || analysis.indicators.length >= 2) {
            console.log(`✅ ANALYSE DE SÉCURITÉ pour ${token.symbol} (${token.address})`);
            console.log(`   Score de sécurité: ${analysis.score}/100`);

            if (analysis.indicators.length > 0) {
                console.log('   Indicateurs positifs:');

                const strengthEmojis = {
                    'HIGH': '🟢',
                    'MEDIUM': '🟡',
                    'LOW': '🟠'
                };

                analysis.indicators.forEach(indicator => {
                    console.log(`   ${strengthEmojis[indicator.strength]} ${indicator.description}`);
                });
            }
        }
    }

    /**
     * Initialise une analyse de sécurité vide
     */
    public initializeSafetyAnalysis(): SafetyAnalysis {
        return {
            score: 50, // Score neutre par défaut
            indicators: []
        };
    }
}

