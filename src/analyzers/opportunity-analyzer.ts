// opportunity-analyzer.ts

import { appConfig } from '../env';
import { Token } from '../models/Token.model';


/* ######################################################### */


/**
 * Analyse d'opportunité initiale lors de la création d'un token
 * Utilisé pour décider si on achète immédiatement après le mint
 */
export interface OpportunityAnalysis {
    score: number;                // 0-100
    recommendedAmount: number;    // en SOL
    confidence: number;           // 0-100
    reasons: string[];            // Raisons de l'opportunité
    metrics: {
        nameScore: number;          // Score du nom (0-100)
        symbolScore: number;        // Score du symbole (0-100)
        socialScore: number;        // Présence sociale (0-100)
        initialVolumeScore: number; // Volume initial (0-100)
        growthPotentialScore: number; // Potentiel de croissance (0-100)
        holdersScore: number;       // Distribution des holders (0-100)
        creatorScore: number;       // Historique du créateur (0-100)
    }
}


/* ######################################################### */


/**
 * Analyseur spécialisé dans la détection d'opportunités d'achat
 * principalement utilisé immédiatement après la création d'un token
 */
export class OpportunityAnalyzer {

    // Liste de mots-clés tendance par catégorie avec multiplicateurs
    private trendingKeywords: {
        keywords: string[];
        multiplier: number;
        category: string;
    }[] = [
            {
                keywords: ['ai', 'artificial', 'intelligence', 'gpt', 'llm', 'ml', 'bot'],
                multiplier: 1.5,
                category: 'AI'
            },
            {
                keywords: ['meme', 'pepe', 'doge', 'wojak', 'cat', 'moon', 'shib', 'inu'],
                multiplier: 1.3,
                category: 'Meme'
            },
            {
                keywords: ['defi', 'yield', 'swap', 'lend', 'borrow', 'stake', 'farm'],
                multiplier: 1.2,
                category: 'DeFi'
            },
            {
                keywords: ['game', 'gaming', 'play', 'nft', 'metaverse', 'p2e'],
                multiplier: 1.25,
                category: 'Gaming'
            }
    ];


    // Liste de mots-clés blacklistés
    private blacklistedKeywords: string[] = [
        'rug', 'scam', 'fake', 'ponzi', 'shit', 'test'
    ];



    /** Analyse un nouveau token pour déterminer s'il représente une opportunité d'achat */
    public analyzeInitialOpportunity(token: Token): OpportunityAnalysis {

        const tokenAge = Date.now() - token.createdAt.getTime()

        // Initialiser les scores individuels
        const nameScore = this.analyzeTokenName(token.name);
        const symbolScore = this.analyzeTokenSymbol(token.symbol);
        const socialScore = this.analyzeSocialPresence(token);
        const creatorScore = this.analyzeCreator(token.creator);
        const holdersScore = this.analyzeHolders(token.holders);

        // Scores pour lesquels on a peu de données initiales
        const initialVolumeScore = token.trades.length < 3 ? 80 : (token.trades.length < 5 ? 60 : 20);
        const growthPotentialScore = token.holders.length < 2 ? 80 : (token.holders.length < 4 ? 50 : 20);
        const ageScore = tokenAge < 3 ? 80 : (tokenAge < 5 ? 60 : (tokenAge < 10 ? 40 : 20));

        // Calculer le score global avec pondérations
        const weightedScore = (
            nameScore * 0.15 +
            symbolScore * 0.10 +
            socialScore * 0.20 +
            initialVolumeScore * 0.25 +
            growthPotentialScore * 0.15 +
            holdersScore * 0.10 +
            ageScore * 0.25 +
            creatorScore * 0.05
        );

        // Arrondir le score
        const finalScore = Math.round(weightedScore);

        // Déterminer le niveau de confiance
        const confidence = this.calculateConfidence(finalScore, token);

        // Déterminer le montant recommandé en fonction du score
        const recommendedAmount = this.calculateRecommendedAmount(finalScore);

        // Générer les raisons de la recommandation
        const reasons = this.generateRecommendationReasons(
            nameScore,
            symbolScore,
            socialScore,
            initialVolumeScore,
            growthPotentialScore,
            holdersScore,
            creatorScore,
            token
        );

        const opportunity: OpportunityAnalysis = {
            score: finalScore,
            recommendedAmount,
            confidence,
            reasons,
            metrics: {
                nameScore,
                symbolScore,
                socialScore,
                initialVolumeScore,
                growthPotentialScore,
                holdersScore,
                creatorScore
            }
        };

        // Affichage optionnel de l'opportunité
        if (0) {
            this.displayOpportunityAnalysis(opportunity, token);
        }

        return opportunity;
    }


    /** Analyse le nom du token pour déterminer sa qualité */
    private analyzeTokenName(name: string): number {
        if (!name) return 0;

        // Normaliser le nom pour l'analyse
        const normalizedName = name.toLowerCase();

        // Vérifier les mots-clés blacklistés
        for (const keyword of this.blacklistedKeywords) {
            if (normalizedName.includes(keyword)) {
                return 0; // Score nul si mot-clé blacklisté
            }
        }

        let score = 50; // Score de base

        // Vérifier la longueur du nom (ni trop court, ni trop long)
        if (name.length < 3) {
            score -= 20;

        } else if (name.length > 20) {
            score -= 10;

        } else if (name.length >= 4 && name.length <= 12) {
            score += 10; // Bonus pour longueur idéale
        }

        // Vérifier si le nom contient un mot-clé tendance
        let highestMultiplier = 1.0;
        let matchedCategory = '';

        for (const trend of this.trendingKeywords) {
            for (const keyword of trend.keywords) {
                if (normalizedName.includes(keyword) && trend.multiplier > highestMultiplier) {
                    highestMultiplier = trend.multiplier;
                    matchedCategory = trend.category;
                    break;
                }
            }
        }

        // Appliquer le multiplicateur pour les mots-clés tendance
        score = Math.min(100, score * highestMultiplier);

        // Vérifier si le nom est mémorable (pas trop de caractères spéciaux)
        const specialCharsCount = (name.match(/[^a-zA-Z0-9]/g) || []).length;
        if (specialCharsCount > name.length / 3) {
            score -= 15; // Pénalité pour trop de caractères spéciaux
        }

        return Math.min(100, Math.max(0, Math.round(score)));
    }


    /** Analyse le symbole du token pour déterminer sa qualité */
    private analyzeTokenSymbol(symbol: string): number {
        if (!symbol) return 0;

        // Normaliser le symbole pour l'analyse
        const normalizedSymbol = symbol.toLowerCase();

        let score = 50; // Score de base

        // Vérifier la longueur du symbole (idéalement entre 3 et 6 caractères)
        if (symbol.length < 2) {
            score -= 20;

        } else if (symbol.length > 6) {
            score -= 10;

        } else if (symbol.length >= 3 && symbol.length <= 5) {
            score += 10;
        }

        // Vérifier si le symbole contient un mot-clé tendance
        for (const trend of this.trendingKeywords) {
            for (const keyword of trend.keywords) {
                if (normalizedSymbol.includes(keyword)) {
                    score += 15;
                    break;
                }
            }
        }

        // Vérifier si le symbole est en majuscules (convention)
        if (symbol === symbol.toUpperCase()) {
            score += 10;
        }

        // Vérifier si le symbole est simple et mémorable
        const specialCharsCount = (symbol.match(/[^a-zA-Z0-9]/g) || []).length;
        if (specialCharsCount === 0) {
            score += 5; // Bonus pour symbole sans caractères spéciaux
        }

        return Math.min(100, Math.max(0, Math.round(score)));
    }


    /** Analyse la présence sociale du token */
    private analyzeSocialPresence(token: Token): number {
        let score = 0;
        let elementsCount = 0;

        // Vérifier le site web
        if (token.website) {
            score += 30;
            elementsCount++;

            // Bonus pour les domaines de qualité
            if (token.website.includes('.io') || token.website.includes('.com')) {
                score += 10;
            }
        }

        // Vérifier Twitter
        if (token.twitter) {
            score += 35;
            elementsCount++;
        }

        // Vérifier Telegram
        if (token.telegram) {
            score += 25;
            elementsCount++;
        }

        // Vérifier l'image
        if (token.image) {
            score += 10;
            elementsCount++;
        }

        // Si aucun élément social, score très bas
        if (elementsCount === 0) {
            return 10; // Score minimum
        }

        // Normaliser le score en fonction du nombre d'éléments présents
        return Math.min(100, Math.round(score / elementsCount));
    }


    /** Analyse la distribution des holders */
    private analyzeHolders(holders: Token['holders']): number {
        if (!holders || holders.length === 0) {
            return 50; // Score neutre par défaut
        }

        let score = 50;

        // Vérifier le pourcentage dans la bonding curve
        const bondingCurve = holders.find(h => h.type === 'bondingCurve');
        if (bondingCurve && bondingCurve.percentage > 95) {
            score += 20; // Excellent si la majorité des tokens est encore dans la bonding curve

        } else if (bondingCurve && bondingCurve.percentage > 90) {
            score += 10;
        }

        // Vérifier si le créateur a peu de tokens
        const creator = holders.find(h => h.type === 'dev');
        if (creator) {
            if (creator.percentage < 1) {
                score += 20; // Excellent si le créateur a très peu de tokens

            } else if (creator.percentage < 3) {
                score += 10;

            } else if (creator.percentage > 10) {
                score -= 30; // Mauvais signe si le créateur a gardé beaucoup de tokens
            }
        }

        return Math.min(100, Math.max(0, Math.round(score)));
    }


    /** Analyse l'historique du créateur (placeholder pour l'instant) */
    private analyzeCreator(creatorAddress: string): number {
        // Note: Cette fonction est un placeholder
        // À l'avenir, elle pourrait analyser l'historique du créateur
        // (tokens précédents, réputation, etc.)

        // TODO

        return 50; // Score neutre par défaut
    }


    /** Calcule le niveau de confiance */
    private calculateConfidence(score: number, token: Token): number {
        // Score de base basé sur le score d'opportunité
        let confidence = score * 0.8;

        // Ajuster selon la présence sociale
        if (token.website && token.twitter && token.telegram) {
            confidence += 15;

        } else if (!token.website && !token.twitter && !token.telegram) {
            confidence -= 20;
        }

        // Ajuster selon les aspects techniques
        const specialCharsInName = (token.name.match(/[^a-zA-Z0-9 ]/g) || []).length;
        if (specialCharsInName > token.name.length / 4) {
            confidence -= 10; // Pénalité pour noms avec trop de caractères spéciaux
        }

        return Math.min(100, Math.max(0, Math.round(confidence)));
    }


    /** Calcule le montant recommandé pour l'investissement */
    private calculateRecommendedAmount(score: number): number {
        // Récupérer les montants de base depuis la config
        const baseInvestment = appConfig.trading.defaultBuyAmount || 0.1; // 0.1 SOL par défaut

        // Ajuster le montant selon le score
        if (score >= 90) {
            return baseInvestment * 2; // x2 pour les opportunités exceptionnelles

        } else if (score >= 80) {
            return baseInvestment * 1.8; // pour les bonnes opportunités

        } else if (score >= 70) {
            return baseInvestment * 1.5; // pour les opportunités

        } else if (score >= 60) {
            return baseInvestment * 1.2;

        } else if (score >= 50) {
            return baseInvestment; // x1

        } else {
            return 0; // Ne pas investir si score < 50
        }
    }


    /** Génère les raisons de la recommandation */
    private generateRecommendationReasons(
        nameScore: number,
        symbolScore: number,
        socialScore: number,
        initialVolumeScore: number,
        growthPotentialScore: number,
        holdersScore: number,
        creatorScore: number,
        token: Token
    ): string[] {
        const reasons: string[] = [];

        // Ajouter des raisons basées sur les scores individuels
        if (nameScore > 70) {
            reasons.push(`Nom attractif: "${token.name}"`);

        } else if (nameScore < 30) {
            reasons.push(`Nom potentiellement problématique`);
        }

        if (symbolScore > 70) {
            reasons.push(`Symbole de qualité: ${token.symbol}`);
        }

        if (socialScore >= 80) {
            reasons.push('Forte présence sociale (site web, Twitter, Telegram)');

        } else if (socialScore >= 50) {
            reasons.push('Présence sociale modérée');

        } else {
            reasons.push('Faible présence sociale - risque plus élevé');
        }

        // Pour les scores avec peu de données initiales, on ajoute des raisons plus génériques
        if (initialVolumeScore === 50) {
            reasons.push('Pas encore d\'historique de volume');
        }

        if (growthPotentialScore === 50) {
            reasons.push('Potentiel de croissance à évaluer');
        }

        if (holdersScore > 70) {
            reasons.push('Distribution initiale saine des holders');

        } else if (holdersScore < 30) {
            reasons.push('Distribution des holders préoccupante');
        }

        // Les scores sont limités à un maximum de 6 raisons pour rester concis
        return reasons.slice(0, 6);
    }


    /** Affiche l'analyse d'opportunité sur la console */
    private displayOpportunityAnalysis(opportunity: OpportunityAnalysis, token: Token): void {
        const scoreEmoji = opportunity.score >= 70 ? '🚀' :
            opportunity.score >= 50 ? '🟡' : '⚠️';

        console.log(`\n${scoreEmoji} OPPORTUNITÉ D'ACHAT pour ${token.symbol} (${token.address})`);
        console.log(`   Score: ${opportunity.score}/100 (Confiance: ${opportunity.confidence}%)`);

        console.log('   Métriques:');
        console.log(`   • Nom: ${opportunity.metrics.nameScore}/100`);
        console.log(`   • Symbole: ${opportunity.metrics.symbolScore}/100`);
        console.log(`   • Présence sociale: ${opportunity.metrics.socialScore}/100`);
        console.log(`   • Distribution: ${opportunity.metrics.holdersScore}/100`);

        if (opportunity.recommendedAmount > 0) {
            console.log(`   Montant recommandé: ${opportunity.recommendedAmount.toFixed(3)} SOL`);
        } else {
            console.log(`   Recommandation: Ne pas investir`);
        }

        console.log('   Raisons:');
        opportunity.reasons.forEach(reason => {
            console.log(`   • ${reason}`);
        });
    }
}
