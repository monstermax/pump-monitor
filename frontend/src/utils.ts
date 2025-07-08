// utils.ts


// Formatage de la date
export const formatDate = (date: Date | string) => {
    if (!date) return 'N/A';

    if (typeof date === 'string') {
        date = new Date(date);
    }

    let dateStr = new Intl.DateTimeFormat('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(date);

    //const year = date.getFullYear();
    //dateStr = dateStr.replace(`/${year} `, ' -')

    return dateStr;
};


// Formatage de la date
export const formatTime = (date: Date | string) => {
    if (!date) return 'N/A';

    if (typeof date === 'string') {
        date = new Date(date);
    }

    let dateStr = new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(date);

    return dateStr;
};


// Formatage du prix
export const formatPrice = (price: number | undefined | string, isSol = true, showCurrency = false) => {
    const currencyStr = showCurrency ? " SOL" : "";

    if (price === undefined || price === null) return isSol ? `0.000000${currencyStr}` : '$0.00';

    price = Number(price);

    if (isSol) {
        return `${price.toFixed(10)}${currencyStr}`;
    }

    return `${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};


// Formatage de la market cap
export const formatMarketCap = (marketCap: number | undefined) => {
    if (marketCap === undefined || marketCap === null) return '$0';
    return `$${marketCap.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};


// Formatage de l'adresse (troncature)
export const formatAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};


// Formatage du type de fenêtre temporelle
export const formatWindowType = (windowType: string) => {
    switch (windowType) {
        case 'ULTRA_SHORT': return 'Very Recent (10s)';
        case 'VERY_SHORT': return 'Recent (30s)';
        case 'SHORT': return 'Short Term (2m)';
        case 'MEDIUM': return 'Medium Term (5m)';
        default: return windowType;
    }
};


// Obtenir la classe CSS pour les scores de risque/sécurité
export const getScoreClass = (score: number, isRisk = false) => {
    if (isRisk) {
        if (score > 70) return 'high-risk';
        if (score > 40) return 'medium-risk';
        return 'low-risk';

    } else {
        if (score > 70) return 'high-safety';
        if (score > 40) return 'medium-safety';
        return 'low-safety';
    }
};


// Obtenir la classe pour le type de trade
export const getTradeTypeClass = (type: 'create' | 'buy' | 'sell') => {
    if (type === 'create') return 'create-trade';
    return type === 'buy' ? 'buy-trade' : 'sell-trade';
};


// Obtenir la classe et l'emoji pour les recommandations
export const getRecommendationInfo = (action: string) => {
    switch (action) {
        case 'BUY':
            return { class: 'buy-recommendation', emoji: '🟢' };
        case 'SELL':
            return { class: 'sell-recommendation', emoji: '🔴' };
        case 'HOLD':
            return { class: 'hold-recommendation', emoji: '🟡' };
        case 'AVOID':
            return { class: 'avoid-recommendation', emoji: '⚫' };
        default:
            return { class: '', emoji: '' };
    }
};


