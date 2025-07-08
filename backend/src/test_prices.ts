
/* ######################################################### */


interface PricePoint {
    timestamp: number; // Timestamp UNIX
    price: number;     // Prix du token
}

interface TokenData {
    symbol: string;
    priceHistory: PricePoint[];
}

interface RatedToken {
    symbol: string;
    growthRate: number;     // Taux de progression
    stability: number;      // Stabilité (inversement proportionnelle à la volatilité)
    score: number;          // Score final
}


/* ######################################################### */


function main(): void {
    const tokenData: TokenData[] = [
        {
            symbol: "TOKEN_A",
            priceHistory: [
                { timestamp: 1672531200, price: 10 },
                { timestamp: 1672617600, price: 11 },
                { timestamp: 1672704000, price: 12 },
                { timestamp: 1672790400, price: 11.5 },
                { timestamp: 1672876800, price: 14 }
            ]
        },
        {
            symbol: "TOKEN_B",
            priceHistory: [
                { timestamp: 1672531200, price: 5 },
                { timestamp: 1672617600, price: 6 },
                { timestamp: 1672704000, price: 5.5 },
                { timestamp: 1672790400, price: 7 },
                { timestamp: 1672876800, price: 6.5 }
            ]
        },
        {
            symbol: "TOKEN_C",
            priceHistory: [
                { timestamp: 1672531200, price: 2 },
                { timestamp: 1672617600, price: 2.1 },
                { timestamp: 1672704000, price: 2.2 },
                { timestamp: 1672790400, price: 2.3 },
                { timestamp: 1672876800, price: 2.4 }
            ]
        },
        {
            symbol: "TOKEN_D",
            priceHistory: [
                { timestamp: 1672531200, price: 12 },
                { timestamp: 1672617600, price: 11 },
                { timestamp: 1672704000, price: 13 },
                { timestamp: 1672790400, price: 8 },
                { timestamp: 1672876800, price: 9 }
            ]
        },
        {
            symbol: "TOKEN_E",
            priceHistory: [
                { timestamp: 1672531200, price: 12 },
                { timestamp: 1672617600, price: 11 },
                { timestamp: 1672704000, price: 10 },
                { timestamp: 1672790400, price: 9 },
                { timestamp: 1672876800, price: 8 }
            ]
        },
    ];

    const rankedTokens = rankTokens(tokenData);
    console.log("Tokens classés par score:", rankedTokens);
}


/** Évalue et classe une liste de tokens */
function rankTokens(tokens: TokenData[]): RatedToken[] {
    // Évaluer chaque token
    const ratedTokens = tokens.map(token => rateToken(token));

    // Trier par score décroissant
    return ratedTokens.sort((a, b) => b.score - a.score);
}



/** Évalue un token en fonction de sa progression et de sa stabilité */
function rateToken(token: TokenData, growthWeight: number = 100, stabilityWeight: number = 0.3): RatedToken {
    // Calculer le taux de croissance
    const growthRate = calculateGrowthRate(token.priceHistory);

    // Calculer la volatilité (écart-type des variations)
    const volatility = calculatePriceStandardDeviation(token.priceHistory);

    // Calculer la stabilité (inversement proportionnelle à la volatilité)
    // Ajout d'une petite valeur pour éviter la division par zéro
    const stability = 1 / (volatility + 0.0001);

    // Normaliser la stabilité pour qu'elle soit dans une plage raisonnable
    const normalizedStability = Math.min(stability, 100);

    // Calculer le score final
    const score = (growthRate * growthWeight) + (normalizedStability * stabilityWeight);

    return {
        symbol: token.symbol,
        growthRate: growthRate * growthWeight,
        stability: normalizedStability * stabilityWeight,
        score
    };
}


/** Calcule le taux de croissance entre le premier et le dernier prix */
function calculateGrowthRate(priceHistory: PricePoint[]): number {
    // Trier l'historique par timestamp croissant
    const sortedHistory = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);

    const initialPrice = sortedHistory[0].price;
    const finalPrice = sortedHistory[sortedHistory.length - 1].price;

    return (finalPrice - initialPrice) / initialPrice;
}


/** Calcule l'écart-type des variations de prix quotidiennes */
function calculatePriceStandardDeviation(priceHistory: PricePoint[]): number {
    // Trier l'historique par timestamp croissant
    const sortedHistory = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);

    // Calculer les variations quotidiennes en pourcentage
    const dailyChanges: number[] = [];
    for (let i = 1; i < sortedHistory.length; i++) {
        const previousPrice = sortedHistory[i - 1].price;
        const currentPrice = sortedHistory[i].price;
        const percentChange = (currentPrice - previousPrice) / previousPrice;
        dailyChanges.push(percentChange);
    }

    // Calculer la moyenne des variations
    const mean = dailyChanges.reduce((sum, change) => sum + change, 0) / dailyChanges.length;

    // Calculer la somme des carrés des écarts
    const squaredDifferences = dailyChanges.map(change => Math.pow(change - mean, 2));

    // Calculer la variance
    const variance = squaredDifferences.reduce((sum, diff) => sum + diff, 0) / dailyChanges.length;

    // Retourner l'écart-type
    return Math.sqrt(variance);
}



/* ######################################################### */


main();

