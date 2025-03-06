// Portfolio.service.ts

import { Keypair, PublicKey } from "@solana/web3.js";

import { ServiceAbstract } from "./abstract.service";
import { Token, TokenHolder, Trade } from "../models/Token.model";
import { Portfolio, PortfolioHolding, PortfolioSettings, PortfolioStats, PortfolioTransaction } from "../models/Portfolio.model";
import { appConfig } from "../env";
import { MagicConnection } from "../lib/solana/MagicConnection";
import { getTokenBalance } from "../lib/solana/account";
import base58 from "bs58";

/* ######################################################### */

export type SellRecommandation = {
    tokenAddress: string;
    tokenSymbol: string;
    amount: number;
    reason: "take_profit" | "stop_loss" | "trailing_stop" | "useless" | "abandonned";
};


/* ######################################################### */

const ignoredHoldings: string[] = [
    'DuNape6nkjxVtfBDkZBdUqhWTvUSvJ2pwKczaGNBpump', // ISCG
    'GxaHqU3QN1j4pQGLKT9FjYSzE9FTaih5SLrBVjQwpump', // GWEASE
];

/* ######################################################### */


export class PortfolioManager extends ServiceAbstract {
    private wallet: Keypair | null = null;
    private balanceSOL: number | null = null;
    private portfolioSettings: PortfolioSettings | null = null;
    private portfolioStats: PortfolioStats | null = null;
    private magicConnection: MagicConnection = new MagicConnection({ rpcs: Array.from(new Set(Object.values(appConfig.solana.rpc))) });


    start() {
        if (this.status !== 'stopped') return;
        super.start();

        this.wallet = this.initializeWallet();
        this.initializeSettings();
        this.initializeStats();

        this.updateBalanceSol();

        this.updateTokensHoldings();


        // Mise à jour régulière de la balance SOL
        this.intervals.updateBalanceSol = setInterval(() => {
            this.updateBalanceSol();
        }, 20_000); // 20 secondes


        // Mise à jour régulière des holdings
        this.intervals.updateHoldings = setInterval(() => {
            this.updateTokensHoldings();
        }, 30_000); // 30 secondes


        this.tokenManager.on('new_trade_added', this.handleNewTrade.bind(this));

        super.started();
    }


    stop() {
        if (this.status !== 'started') return;
        super.stop();

        this.tokenManager.off('new_trade_added', this.handleNewTrade.bind(this));

        super.stopped();
    }



    /** Initialize le wallet */
    private initializeWallet(): Keypair | null {
        // Récupérer la private key depuis les variables d'environnement
        const privateKeyString = appConfig.solana.WalletPrivateKey;

        if (!privateKeyString) {
            //throw new Error('WALLET_PRIVATE_KEY environment variable is not set');
            console.warn(`WALLET_PRIVATE_KEY environment variable is not set`);
            return null;
        }

        try {
            // Convertir la private key en Uint8Array pour créer le Keypair
            const privateKeyBytes = base58.decode(privateKeyString);
            return Keypair.fromSecretKey(privateKeyBytes);

        } catch (err: any) {
            console.error('Failed to initialize wallet:', err);
            throw new Error('Failed to initialize wallet. Check WALLET_PRIVATE_KEY format.');
        }
    }



    private handleNewTrade(trade: Trade) {
        this.updateHoldingPrice(trade.tokenAddress, trade.price);
    }


    getPortfolio(): Portfolio | null {
        const wallet = this.getWallet();
        if (! wallet) return null;

        const walletAddress = wallet.publicKey.toBase58();
        const balanceSOL = this.getBalanceSOL();
        const holdings = this.db.getAllHoldings();
        const stats = this.portfolioStats ?? this.getEmptyStats();
        const settings = this.portfolioSettings ?? appConfig.trading;

        const portfolio: Portfolio = {
            walletAddress,
            balanceSOL,
            holdings,
            stats,
            settings,
            autoTrading: this.trading.isAutoTradingEnabled() ?? false,
        };

        return portfolio;
    }


    getEmptyStats() {
        const emptyStats: PortfolioStats = {
            totalValue: 0,
            totalInvestment: 0,
            totalProfitLoss: 0,
            totalProfitLossPercent: 0,
            bestPerforming: {
                tokenAddress: '',
                tokenSymbol: '',
                profitLossPercent: 0
            },
            worstPerforming: {
                tokenAddress: '',
                tokenSymbol: '',
                profitLossPercent: 0
            },
            lastUpdated: new Date()
        };

        return emptyStats;
    }



    getWallet(): Keypair | null {
        return this.wallet;
    }


    getSettings(): PortfolioSettings | null {
        return this.portfolioSettings;
    }



    getBalanceSOL(): number {
        return this.balanceSOL ?? 0;
    }


    setBalanceSOL(newBalanceSOL: number): void {
        this.balanceSOL = newBalanceSOL;
    }


    increaseBalanceSOL(offset: number): void {
        this.balanceSOL = (this.balanceSOL ?? 0) + offset;
    }


    decreaseBalanceSOL(offset: number): void {
        this.balanceSOL = (this.balanceSOL ?? 0) - offset;
    }



    async updateBalanceSol() {
        const oldBalanceSOL = this.getBalanceSOL();
        let balanceLamports = 0;

        if (this.wallet) {
            try {
                const newBalanceLamports = await this.magicConnection.getBalance(this.wallet.publicKey)
                balanceLamports = newBalanceLamports;

            } catch (err: any) {
                this.warn(`Erreur de récupération de la balance. ${err.message}`);
                return;
            }
        }

        const balanceSOL = balanceLamports / 1e9;

        if (balanceSOL !== oldBalanceSOL) {
            this.balanceSOL = balanceSOL;
            this.emit('wallet_update', balanceSOL);

            this.log(`Nouveau solde SOL: ${balanceSOL}`)
        }
    }


    private async updateTokensHoldings(): Promise<void> {
        if (!this.wallet) {
            this.warn('Cannot fetch tokens from blockchain: wallet not initialized');
            return;
        }

        try {
            this.log('Fetching tokens from blockchain...');

            // Récupérer les SPL tokens du wallet
            const response = await this.magicConnection.getParsedTokenAccountsByOwner(
                this.wallet.publicKey,
                { programId: new PublicKey(appConfig.pumpfun.PUMP_TOKEN) } // Token Program ID
            );

            this.log(`Found ${response.value.length} token accounts`);

            // Traiter chaque token
            for (const account of response.value) {
                const parsedInfo = account.account.data.parsed.info;
                const mintAddress: string = parsedInfo.mint;
                const amount: number = parsedInfo.tokenAmount.uiAmount;

                if (ignoredHoldings.includes(mintAddress)) continue;

                // Vérifier si le token existe déjà dans notre liste locale
                const existingHolding = this.db.getTokenHolding(mintAddress);

                // Ignorer les tokens avec solde 0
                if (amount <= 0.000001 && this.db.getTokenHolding(mintAddress)) {
                    this.db.deleteTokenHolding(mintAddress);
                    continue;
                }

                this.log(`Token: ${mintAddress}, Balance: ${amount}`);


                if (!existingHolding) {
                    // Token non suivi, l'ajouter à notre portfolio
                    try {
                        // Essayer de récupérer les métadonnées du token
                        let token = this.db.getTokenByAddress(mintAddress);

                        if (! token) {
                            token = await this.fetchTokenMetadataAndCreateToken(mintAddress, amount);

                            if (token) {
                                this.db.addToken(token);
                                this.log(`Created new token in database: ${token.symbol} (${mintAddress})`);
                            }
                        }

                        if (token) {
                            // Si on a les infos du token, on peut calculer la valeur
                            this.syncTokenBalance(token, amount);

                        } else {
                            // Si on n'a pas d'infos sur ce token, on pourrait le stocker avec des infos minimales
                            this.log(`Unknown token: ${mintAddress}, not adding to portfolio tracking`);
                        }

                    } catch (err: any) {
                        this.error(`Error processing token ${mintAddress}: ${err.message}`);
                    }

                } else if (Math.abs(existingHolding.amount - amount) > 0.000001) {
                    // Si le solde a changé, mettre à jour notre tracking
                    const token = this.db.getTokenByAddress(mintAddress);

                    if (token) {
                        this.syncTokenBalance(token, amount);
                    }
                }
            }


            // TODO: parcourir les holdings (en mémoire/database) et supprimer celles qui n'existe pas sur la blockchain (ou qui ont un solde nul)


            // Mettre à jour les statistiques du portefeuille
            this.updateStats();

            // Émettre un événement pour informer du rafraîchissement des données
            this.emit('portfolio_refreshed');

        } catch (err: any) {
            this.error(`Error fetching tokens from blockchain: ${err.message}`);
        }
    }


    private syncTokenBalance(token: Token, onchainAmount: number): void {
        const existingHolding = this.db.getTokenHolding(token.address);

        if (existingHolding) {
            if (Math.abs(existingHolding.amount - onchainAmount) > 0.000001) {
                this.log(`Updating token ${token.symbol} balance: ${existingHolding.amount} -> ${onchainAmount}`);

                // Calculer les nouvelles valeurs
                const newCurrentValue = onchainAmount * Number(token.price);
                const profitLoss = newCurrentValue - existingHolding.totalInvestment;
                const profitLossPercent = existingHolding.totalInvestment > 0
                    ? (profitLoss / existingHolding.totalInvestment) * 100
                    : 0;

                // Créer un holding mis à jour
                const updatedHolding: PortfolioHolding = {
                    ...existingHolding,
                    amount: onchainAmount,
                    currentValue: newCurrentValue,
                    profitLoss,
                    profitLossPercent,
                    lastUpdated: new Date()
                };

                // Sauvegarder les modifications
                this.db.setTokenHolding(updatedHolding);

            } else {
                this.db.deleteTokenHolding(token.address);
            }

        } else if (onchainAmount > 0) {
            // Créer un nouveau holding pour ce token
            this.log(`Adding new token to portfolio: ${token.symbol} (${onchainAmount})`);

            // On ne connaît pas l'historique d'achat, donc on estime
            const estimatedInvestment = onchainAmount * Number(token.price);

            const newHolding: PortfolioHolding = {
                tokenAddress: token.address,
                tokenSymbol: token.symbol,
                tokenName: token.name,
                amount: onchainAmount,
                avgBuyPrice: token.price, // Estimation basée sur le prix actuel
                totalInvestment: estimatedInvestment, // Estimation basée sur le prix actuel
                currentPrice: token.price,
                currentValue: onchainAmount * Number(token.price),
                profitLoss: 0, // Pas de P/L car on estime que c'est l'achat initial
                profitLossPercent: 0,
                lastUpdated: new Date(),
                transactions: [] // Pas de transactions connues
            };

            this.db.setTokenHolding(newHolding);
        }
    }


    private async fetchTokenMetadataAndCreateToken(mintAddress: string, ourBalance=0): Promise<Token | null> {
        try {
            this.log(`Fetching metadata for unknown token from Pump.fun API: ${mintAddress}`);

            // Utiliser l'API Pump.fun pour récupérer toutes les informations
            const response = await fetch(`https://frontend-api-v3.pump.fun/coins/${mintAddress}`);

            if (!response.ok) {
                this.warn(`Failed to fetch token data from Pump.fun API: ${mintAddress} (Status: ${response.status})`);
                return null;
            }

            const pumpData = await response.json();


            // Calculer le prix actuel en SOL
            const price = pumpData.virtual_sol_reserves && pumpData.virtual_token_reserves
                ? (pumpData.virtual_sol_reserves / 1e9) / (pumpData.virtual_token_reserves / 1e6)
                : 0;

            const totalSupply = pumpData.total_supply ? Number(pumpData.total_supply) / 1e6 : 0;
            const marketCapSOL = pumpData.market_cap || 0;
            const marketCapUSD = pumpData.usd_market_cap || 0;

            let curveBalance = totalSupply - ourBalance;


            // Créer l'objet Token à partir des données de l'API
            const newToken: Token = {
                address: mintAddress,
                creator: pumpData.creator || '',
                name: pumpData.name || `Unknown ${mintAddress.slice(0, 6)}`,
                symbol: pumpData.symbol || 'UNKNOWN',
                uri: pumpData.metadata_uri || '',
                image: pumpData.image_uri || '',
                website: pumpData.website || '',
                twitter: pumpData.twitter || '',
                telegram: pumpData.telegram || '',
                createdAt: new Date(pumpData.created_timestamp || Date.now()),
                price: price.toFixed(10),
                totalSupply: totalSupply,
                marketCapSOL,
                marketCapUSD,
                trades: [],
                holders: [],
                analyticsSummary: null,
                lastUpdated: new Date(),
                boundingCurve: { address: pumpData.bonding_curve, percentage: 100, solAmount: 0, tokenAmount: totalSupply },
                milestones: [],
                trends: {},
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


            // Ajouter la bonding curve en holder
            if (pumpData.bonding_curve) {
                const bondingCurveHolder: TokenHolder = {
                    address: pumpData.bonding_curve,
                    percentage: 100 * curveBalance / totalSupply,
                    tokenBalance: curveBalance,
                    type: 'bondingCurve' as const,
                    lastUpdate: new Date,
                    firstBuy: new Date,
                    tradesCount: 0,
                    tokenBlanceMax: curveBalance,
                };
                newToken.holders.push(bondingCurveHolder);
            }


            // Ajouter notre holding
            if (ourBalance && this.wallet) {
                const meHolder: TokenHolder = {
                    address: this.wallet.publicKey.toBase58(),
                    percentage: 100 * ourBalance / totalSupply,
                    tokenBalance: ourBalance,
                    type: pumpData.creator === this.wallet.publicKey.toBase58() ? 'dev' : 'trader',
                    lastUpdate: new Date,
                    firstBuy: new Date,
                    tokenBlanceMax: ourBalance,
                    tradesCount: 0,
                };
                newToken.holders.push(meHolder);
            }

            return newToken;

        } catch (err: any) {
            this.error(`Error fetching metadata for token ${mintAddress} from Pump.fun API: ${err.message}`);
            return null;
        }
    }


    // Initialiser les settings par défaut si nécessaire
    private initializeSettings(): void {
        if (!this.portfolioSettings) {
            this.portfolioSettings = appConfig.trading;
        }
    }


    private initializeStats(): void {
        this.portfolioStats = this.getEmptyStats();
    }


    // Mettre à jour les settings
    updateSettings(newSettings: Partial<PortfolioSettings>): void {
        if (! this.portfolioSettings) {
            this.portfolioSettings = appConfig.trading;
        }

        Object.assign(this.portfolioSettings, newSettings);
    }


    // Mettre à jour les statistiques
    updateStats(): void {
        const holdings = this.db.getAllHoldings();

        if (holdings.length === 0) {
            // Réinitialiser les stats si aucun holding
            this.portfolioStats = this.getEmptyStats();

            return;
        }

        // Calculer les totaux
        const totalInvestment = holdings.reduce((sum, h) => sum + h.totalInvestment, 0);
        const totalValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
        const totalProfitLoss = totalValue - totalInvestment;
        const totalProfitLossPercent = totalInvestment > 0
            ? (totalProfitLoss / totalInvestment) * 100
            : 0;

        // Trouver le meilleur et le pire performer
        let bestPerforming = holdings[0];
        let worstPerforming = holdings[0];

        for (const holding of holdings) {
            if (holding.profitLossPercent > bestPerforming.profitLossPercent) {
                bestPerforming = holding;
            }
            if (holding.profitLossPercent < worstPerforming.profitLossPercent) {
                worstPerforming = holding;
            }
        }

        this.portfolioStats = {
            totalValue,
            totalInvestment,
            totalProfitLoss,
            totalProfitLossPercent,
            bestPerforming: {
                tokenAddress: bestPerforming.tokenAddress,
                tokenSymbol: bestPerforming.tokenSymbol,
                profitLossPercent: bestPerforming.profitLossPercent
            },
            worstPerforming: {
                tokenAddress: worstPerforming.tokenAddress,
                tokenSymbol: worstPerforming.tokenSymbol,
                profitLossPercent: worstPerforming.profitLossPercent
            },
            lastUpdated: new Date()
        };
    }


    async updateHoldingBalance(tokenAddress: string, action: 'buy' | 'sell' | 'update holding' = 'update holding') {
        if (!this.wallet) return;

        const balance: bigint = await getTokenBalance(this.magicConnection, this.wallet, tokenAddress);
        const tokenBalance = Number(balance) / 1e6;

        const newHolding = this.db.getTokenHolding(tokenAddress);

        if (newHolding) {
            newHolding.amount = tokenBalance;

        } else {
            this.warn(`Holding non trouvé après ${action} ?!`);
        }

        this.emit('portfolio_refreshed');
    }



    // Vérifier s'il faut vendre un token basé sur les conditions de stop loss ou take profit
    checkSellConditions(): SellRecommandation[] {
        const settings = this.portfolioSettings;
        const holdings = this.db.getAllHoldings();
        const sellRecommendations: SellRecommandation[] = [];

        if (!settings || !settings.autoSellEnabled) {
            return [];
        }

        for (const holding of holdings) {
            const token = this.db.getTokenByAddress(holding.tokenAddress);
            if (! token) throw new Error(`Token à vendre non trouvé`);

            const minPrice = token.kpis.priceMax;
            const maxPrice = token.kpis.priceMin;
            const priceOffset = Number(maxPrice) - Number(minPrice);
            const currentPrice = token.price;
            const percentOfAth = 100 * (Number(currentPrice) - Number(minPrice)) / priceOffset;

            if (holding.amount * Number(currentPrice) < 0.001) {
                sellRecommendations.push({
                    tokenAddress: holding.tokenAddress,
                    tokenSymbol: holding.tokenSymbol,
                    amount: 0,
                    reason: 'useless' as const
                });

            } else if (Date.now() - token.lastUpdated.getTime() > 30_000) {
                // Pas d'activité depuis plus de 30 secondes
                sellRecommendations.push({
                    tokenAddress: holding.tokenAddress,
                    tokenSymbol: holding.tokenSymbol,
                    amount: holding.amount, // Vendre 100%
                    reason: 'abandonned' as const
                });

            } else if (holding.profitLossPercent >= settings.takeProfitPercent) {
                let amount = holding.amount * 0.5;

                if ((amount - holding.amount) * Number(token.price) < 0.01) {
                    amount = holding.amount;
                }

                // Take profit
                sellRecommendations.push({
                    tokenAddress: holding.tokenAddress,
                    tokenSymbol: holding.tokenSymbol,
                    amount, // Vendre 50% quand on atteint take profit
                    reason: 'take_profit' as const
                });

            } else if (holding.profitLossPercent <= -settings.stopLossPercent) {
                // Stop loss
                sellRecommendations.push({
                    tokenAddress: holding.tokenAddress,
                    tokenSymbol: holding.tokenSymbol,
                    amount: holding.amount, // Vendre 100% en stop loss
                    reason: 'stop_loss' as const
                });

            } else if (percentOfAth < 90) {
                // trailing stop
                let amount = holding.amount * 0.5;

                if ((amount - holding.amount) * Number(token.price) < 0.01) {
                    amount = holding.amount;
                }

                sellRecommendations.push({
                    tokenAddress: holding.tokenAddress,
                    tokenSymbol: holding.tokenSymbol,
                    amount: amount, // Vendre 50%
                    reason: 'trailing_stop' as const
                });

            } else if (percentOfAth < 80) {
                // trailing stop
                sellRecommendations.push({
                    tokenAddress: holding.tokenAddress,
                    tokenSymbol: holding.tokenSymbol,
                    amount: holding.amount, // Vendre 100%
                    reason: 'trailing_stop' as const
                });

            }

        }

        return sellRecommendations;
    }


    // Vérifier si on peut acheter un nouveau token basé sur les conditions actuelles
    canBuyToken(tokenAddress: string, score: number, solAmount?: number): {
        canBuy: boolean,
        reason?: string,
        recommendedAmount?: number
    } {
        const settings = this.portfolioSettings;
        const stats = this.portfolioStats;
        const holdings = this.db.getAllHoldings();

        if (! settings) {
            return { canBuy: false, reason: 'settings manquants' };
        }

        if (! stats) {
            return { canBuy: false, reason: 'stats manquants' };
        }

        // Montant à investir
        const amountToInvest = solAmount || settings.defaultBuyAmount;

        // Vérifier si l'achat automatique est activé
        if (!settings.autoBuyEnabled || !solAmount) {
            return { canBuy: false, reason: 'Auto buy is disabled' };
        }

        // Vérifier si on a déjà ce token
        const existingHolding = holdings.find(h => h.tokenAddress === tokenAddress);
        if (existingHolding) {
            return { canBuy: false, reason: 'Token already in portfolio' };
        }

        // Vérifier le nombre maximum d'investissements simultanés
        if (holdings.length + this.trading.getPendingBuys() >= settings.maxConcurrentInvestments) {
            return { canBuy: false, reason: 'Maximum concurrent investments reached' };
        }

        const availableAmount = this.getBalanceSOL() - appConfig.trading.minSolInWallet;
        if (amountToInvest > availableAmount) {
            return { canBuy: false, reason: 'Wallet almost empty' };
        }

        // Vérifier la limite totale du portefeuille
        if (stats.totalValue + amountToInvest > settings.totalPortfolioLimit) {
            const availableAmount = Math.max(0, settings.totalPortfolioLimit - stats.totalValue);

            if (availableAmount > 0.01) { // Seuil minimum pour que ça vaille la peine
                return {
                    canBuy: true,
                    reason: 'Portfolio limit exceeded, amount adjusted',
                    recommendedAmount: availableAmount
                };

            } else {
                return { canBuy: false, reason: 'Portfolio limit reached' };
            }
        }

        // Vérifier le montant maximum par token
        if (amountToInvest > settings.maxSolPerToken) {
            return {
                canBuy: true,
                reason: 'Amount exceeds maximum per token, amount adjusted',
                recommendedAmount: settings.maxSolPerToken
            };
        }

        // Vérifier les scores de sécurité et de risque
        if (score < settings.minTokenScore) {
            return { canBuy: false, reason: `Token Score too low (${score}). Required: score > ${settings.minTokenScore}` };
        }

        // Tous les contrôles sont passés
        return { canBuy: true, recommendedAmount: amountToInvest };
    }


    // Ajouter une transaction à un holding
    addTransaction(tokenAddress: string, transaction: PortfolioTransaction): void {
        const holding = this.db.getTokenHolding(tokenAddress);
        if (!holding) return;

        holding.transactions.push(transaction);
    }


    // Enregistrer une transaction d'achat
    async recordBuyTransaction(
        token: Token,
        solAmount: number,
        tokenAmount: number,
        txHash: string
    ): Promise<void> {
        const transaction: PortfolioTransaction = {
            timestamp: new Date(),
            type: 'buy',
            solAmount,
            tokenAmount,
            price: solAmount / tokenAmount,
            txHash,
            status: 'pending'
        };

        // Vérifier si on a déjà un holding pour ce token
        const holding = this.db.getTokenHolding(token.address);

        if (holding) {
            // Mettre à jour le holding existant
            this.updateHoldingPerformance(holding, tokenAmount, solAmount, token.price);

        } else {
            // Créer un nouveau holding
            const newHolding: PortfolioHolding = {
                tokenAddress: token.address,
                tokenSymbol: token.symbol,
                tokenName: token.name,
                amount: tokenAmount,
                avgBuyPrice: (solAmount / tokenAmount).toFixed(),
                totalInvestment: solAmount,
                currentPrice: token.price,
                currentValue: tokenAmount * Number(token.price),
                profitLoss: (tokenAmount * Number(token.price)) - solAmount,
                profitLossPercent: (((tokenAmount * Number(token.price)) - solAmount) / solAmount) * 100,
                lastUpdated: new Date(),
                transactions: [transaction]
            };

            this.db.addTokenHolding(newHolding);
        }


        this.decreaseBalanceSOL(solAmount);
        this.emit('wallet_update', this.getBalanceSOL());

        // Mettre à jour les statistiques du portefeuille
        this.updateStats();


        // Mise a jour du solde SOL
        await this.updateBalanceSol();
        this.emit('wallet_update', this.getBalanceSOL());


        // mise a jour du solde de tokens (holding. pas les holders)
        await this.updateHoldingBalance(token.address, 'buy');
    }




    // Enregistrer une transaction de vente
    async recordSellTransaction(
        token: Token,
        solAmount: number,
        tokenAmount: number,
        txHash: string
    ): Promise<void> {
        const holding = this.db.getTokenHolding(token.address);

        if (!holding) {
            throw new Error(`No holding found for token ${token.address}`);
        }

        // Vérifier si on a assez de tokens à vendre
        if (holding.amount < tokenAmount) {
            if (tokenAmount > 0.9 * holding.amount) {
                tokenAmount = holding.amount;

            } else {
                throw new Error(`Insufficient token balance. Have: ${holding.amount}, trying to sell: ${tokenAmount}`);
            }
        }

        const transaction: PortfolioTransaction = {
            timestamp: new Date(),
            type: 'sell',
            solAmount,
            tokenAmount,
            price: solAmount / tokenAmount,
            txHash,
            status: 'pending'
        };


        // Calculer les nouvelles valeurs
        const newAmount = holding.amount - tokenAmount;


        // Si on vend tout, on peut supprimer le holding
        if (newAmount <= 0.000001) {
            // Ajouter quand même la transaction pour garder l'historique
            this.addTransaction(token.address, transaction);

            // Puis supprimer le holding
            this.db.deleteTokenHolding(token.address);

        } else {
            this.updateHoldingPerformance(holding, tokenAmount, solAmount, token.price);
        }


        this.increaseBalanceSOL(solAmount);
        this.emit('wallet_update', this.getBalanceSOL());

        // Mettre à jour les statistiques du portefeuille
        this.updateStats();


        // Mise a jour du solde SOL
        await this.updateBalanceSol();
        this.emit('wallet_update', this.getBalanceSOL());


        // mise a jour du solde de tokens (holding. pas les holders)
        await this.updateHoldingBalance(token.address, 'sell');

    }


    private updateHoldingPrice(tokenAddress: string, newPrice: string): void {
        const holding = this.db.getTokenHolding(tokenAddress);
        if (!holding) return;

        const oldValue = holding.currentValue;

        // Mise à jour du prix et de la valeur
        holding.currentPrice = newPrice;
        holding.currentValue = holding.amount * Number(newPrice);

        // Mise à jour des profits/pertes
        holding.profitLoss = holding.currentValue - holding.totalInvestment;
        holding.profitLossPercent = (holding.profitLoss / holding.totalInvestment) * 100;

        // Mise à jour de la date
        holding.lastUpdated = new Date();
    }


    private updateHoldingPerformance(holding: PortfolioHolding, tokenAmount: number, solAmount: number, tokenPrice: string) {

        // Mettre à jour le holding existant
        const newTotalTokens = holding.amount + tokenAmount;
        const newTotalInvestment = holding.totalInvestment + solAmount;
        const newAvgBuyPrice = newTotalInvestment / newTotalTokens;
        const newCurrentValue = newTotalTokens * Number(tokenPrice);
        const newProfitLoss = newCurrentValue - newTotalInvestment;
        const newProfitLossPercent = (newProfitLoss / newTotalInvestment) * 100;

        const update: Partial<PortfolioHolding> = {
            amount: newTotalTokens,
            totalInvestment: newTotalInvestment,
            avgBuyPrice: newAvgBuyPrice.toFixed(10),
            currentValue: newCurrentValue,
            profitLoss: newProfitLoss,
            profitLossPercent: newProfitLossPercent,
            currentPrice: tokenPrice,
            lastUpdated: new Date,
        };

        Object.assign(holding, update);
    }

}


