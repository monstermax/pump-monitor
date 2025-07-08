// TokenManager.service.ts

import { TokenMetadata } from "../../lib/pumpfun/pumpfun_token_metadata";
import { Token, TokenHolder, Trade } from "../models/Token.model";
import { ServiceAbstract } from "./abstract.service";


/* ######################################################### */


export class TokenManager extends ServiceAbstract {

    start() {
        if (this.status !== 'stopped') return;
        super.start();

        this.listener.on('new_token_received', this.handleNewToken.bind(this));
        this.listener.on('new_trade_received', this.handleNewTrade.bind(this));

        super.started();
    }


    stop() {
        if (this.status !== 'started') return;
        super.stop();

        this.listener.off('new_token_received', this.handleNewToken.bind(this));
        this.listener.off('new_trade_received', this.handleNewTrade.bind(this));

        super.stopped();
    }




    private async handleNewToken(token: Token, devTrade?: Trade) {
        //console.log('DEBUG TokenManager: handleNewToken', token);

        // Enregistrement du token
        this.db.addToken(token);


        // Telechargement des metadata JSON
        if (token.uri && !token.image) {
            this.fetchAndAssignTokenMetadata(token);
        }

        this.emit('new_token_added', token, devTrade);
    }


    private async handleNewTrade(trade: Trade) {
        //console.log('DEBUG TokenManager: handleTrade', trade);

        const token = this.db.getTokenByAddress(trade.tokenAddress);

        if (!token) {
            this.warn(`Token ${trade.tokenAddress} non trouvé pour ${trade.type} ${trade.solAmount.toFixed(3)} SOL par ${trade.traderAddress}`);
            return;
        }

        // Mise à jour du token (price, trends, holders, marketcap, ...)
        this.updateTokenAfterTrade(token, trade);

        this.emit('new_trade_added', trade);
    }


    private fetchAndAssignTokenMetadata(token: Token): void {
        fetch(token.uri)
            .then(response => response.json())
            .then((metadata: TokenMetadata) => {
                this.db.updateToken(token.address, metadata);
            })
            .catch(() => {
                this.warn(`Erreur de fetch pendant la récupération des metadata du token ${token.address}`);
            })
    }


    private updateTokenAfterTrade(token: Token, trade: Trade): void {
        // Ajouter le trade à l'historique
        token.trades.push(trade);

        // Mettre à jour le prix actuel du token
        token.price = trade.price;

        // Mettre à jour les market caps
        token.marketCapSOL = trade.marketCapSOL;
        token.marketCapUSD = trade.marketCapUSD;

        // Mettre à jour la date de dernière mise à jour
        token.lastUpdated = new Date();

        // Mettre à jour les KPIs
        this.updateTokenKpis(token, trade);

        // Mettre à jour les holders si les informations sont disponibles
        if (trade.traderAddress) {
            this.updateTokenHolders(token, trade);
        }

        // Mettre à jour la bonding curve (en utilisant les données du trade)
        if (trade.type === 'buy') {
            // Lors d'un achat, les tokens quittent la bonding curve
            token.boundingCurve.tokenAmount -= trade.tokenAmount;
            token.boundingCurve.solAmount += trade.solAmount;
        } else if (trade.type === 'sell') {
            // Lors d'une vente, les tokens retournent dans la bonding curve
            token.boundingCurve.tokenAmount += trade.tokenAmount;
            token.boundingCurve.solAmount -= trade.solAmount;
        }

        // Recalculer le pourcentage de tokens dans la bonding curve
        if (token.totalSupply > 0) {
            token.boundingCurve.percentage = (token.boundingCurve.tokenAmount / token.totalSupply) * 100;
        }

        // Sauvegarder les modifications dans la base de données
        this.db.setToken(token);
    }


    // Méthode auxiliaire pour mettre à jour les KPIs du token
    private updateTokenKpis(token: Token, trade: Trade): void {
        // Mettre à jour les prix min/max
        const currentPrice = Number(trade.price);
        const minPrice = Number(token.kpis.priceMin);
        const maxPrice = Number(token.kpis.priceMax);

        if (currentPrice < minPrice || minPrice === 0) {
            token.kpis.priceMin = trade.price;
        }

        if (currentPrice > maxPrice) {
            token.kpis.priceMax = trade.price;
        }

        // Mettre à jour les market caps min/max
        if (trade.marketCapUSD < token.kpis.marketCapUSDMin || token.kpis.marketCapUSDMin === 0) {
            token.kpis.marketCapUSDMin = trade.marketCapUSD;
        }

        if (trade.marketCapUSD > token.kpis.marketCapUSDMax) {
            token.kpis.marketCapUSDMax = trade.marketCapUSD;
        }
    }


    // Méthode auxiliaire pour mettre à jour les holders du token
    private updateTokenHolders(token: Token, trade: Trade): void {
        const now = new Date();
        const traderAddress = trade.traderAddress;
        const isDev = traderAddress === token.creator;

        // Chercher si le trader existe déjà dans les holders
        let holderIndex = token.holders.findIndex(h => h.address === traderAddress);
        let holder: TokenHolder | undefined = holderIndex >= 0 ? token.holders[holderIndex] : undefined;

        if (trade.type === 'buy') {
            if (holder) {
                // Mettre à jour un holder existant
                holder.tokenBalance += trade.tokenAmount;
                holder.tokenBalanceMax = Math.max(holder.tokenBalanceMax, holder.tokenBalance);
                holder.tradesCount++;
                holder.lastUpdate = now;
            } else {
                // Créer un nouveau holder
                const newHolder: TokenHolder = {
                    address: traderAddress,
                    tokenBalance: trade.tokenAmount,
                    percentage: 0, // Sera calculé plus tard
                    type: isDev ? 'dev' : 'trader',
                    tradesCount: 1,
                    firstBuy: now,
                    lastUpdate: now,
                    tokenBalanceMax: trade.tokenAmount,
                };
                token.holders.push(newHolder);
                holderIndex = token.holders.length - 1;
                holder = newHolder;

                // Mettre à jour le nombre de holders dans les KPIs
                token.kpis.holdersMax = Math.max(token.kpis.holdersMax, token.holders.length);
                token.kpis.holdersMin = token.kpis.holdersMin === 0 ? token.holders.length : token.kpis.holdersMin;
            }

        } else if (trade.type === 'sell' && holder) {
            // Mettre à jour la balance lors d'une vente
            holder.tokenBalance -= trade.tokenAmount;
            holder.tradesCount++;
            holder.lastUpdate = now;

            // Si le holder n'a plus de tokens, on pourrait le supprimer ou le marquer
            if (holder.tokenBalance <= 0) {
                token.holders = token.holders.filter(h => h.address !== traderAddress);
                token.kpis.holdersMin = Math.min(token.kpis.holdersMin, token.holders.length);
            }
        }

        // Mettre à jour les pourcentages
        if (token.totalSupply > 0) {
            token.holders.forEach(h => {
                h.percentage = (h.tokenBalance / token.totalSupply) * 100;
            });
        }

        // Mettre à jour les KPIs dev balance si c'est le créateur
        if (isDev) {
            const devBalance = holder?.tokenBalance || 0;

            if (token.kpis.devBalanceMin === null || devBalance < token.kpis.devBalanceMin) {
                token.kpis.devBalanceMin = devBalance;
            }

            if (token.kpis.devBalanceMax === null || devBalance > token.kpis.devBalanceMax) {
                token.kpis.devBalanceMax = devBalance;
            }
        }
    }

}

