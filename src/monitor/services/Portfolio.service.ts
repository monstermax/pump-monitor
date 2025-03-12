// Portfolio.service.ts

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { MintLayout } from '@solana/spl-token';


import { ServiceAbstract } from "./abstract.service";
import { Token, TokenHolder, Trade } from "../models/Token.model";
import { Portfolio, PortfolioHolding, PortfolioSettings, PortfolioStats, PortfolioTransaction } from "../models/Portfolio.model";
import { appConfig } from "../../env";
import { MagicConnection } from "../../lib/solana/MagicConnection";
import { getTokenBalance } from "../../lib/solana/account";
import base58 from "bs58";
import { MIN_BUY_SOL_AMOUNT, MIN_SELL_SOL_VALUE, MIN_SELL_TOKEN_AMOUNT } from "./Trading.service";
import { PUMPFUN_TOKEN_PROGRAM_ID } from "../../lib/pumpfun/pumpfun_config";

/* ######################################################### */

export type SellRecommandation = {
    tokenAddress: string;
    tokenSymbol: string;
    amount: number;
    reason: "take_profit" | "stop_loss" | "trailing_stop" | "wothless" | "abandonned" | "analysis_sell_recommandation";
};


/* ######################################################### */

const ignoredHoldings: string[] = [
    //'DuNape6nkjxVtfBDkZBdUqhWTvUSvJ2pwKczaGNBpump', // ISCG
    //'GxaHqU3QN1j4pQGLKT9FjYSzE9FTaih5SLrBVjQwpump', // GWEASE
    //'BQwYE9jDG8MmLNrTY82J8Lq63YGR6namdpBERckEpump', // McTrump
    //'9rvodi8iwywa8PBQEoWBkyiMooRmE8k35MgMETiLpump', // SS
    //'8hgBvGP4mnrHWjxXxqBjJ4yX6JgJGweafBqamvEbpump', // DICK9
    //'4UHcBGsEHYRkfv6HNDXNc8w7gTK8atodmqPa1Zerpump', // SOL
    //'7kJjFSs6xdP82WArySpjX83S2qxHhCMrrYD4oN6Hpump', // JPEPE
    //'6pBxRC9pboKQrKkm6uUHsikx35C6DViNewzDA4SGkJHh', // RAND
    //'3mHkrYfrDnsb4UBAXijZ8oGFr5kSKZeiuHG1ApXzpump', // gru
    //'DZhshUYkRGiUCL2RThxFmsZZ7C8cQyDeUJvFVrsTpump', // chweeto
];


const portfolioRpcs = [
    //appConfig.solana.rpc.chainstack, // getParsedTokenAccountsByOwner => Method requires plan upgrade
    appConfig.solana.rpc.helius,
    appConfig.solana.rpc.alchemy,
    appConfig.solana.rpc.heliusJpp,
    appConfig.solana.rpc.quicknode,
    appConfig.solana.rpc.shyft,
    appConfig.solana.rpc.nownodes,
    appConfig.solana.rpc.solana,
];


/* ######################################################### */


export class PortfolioManager extends ServiceAbstract {
    private wallet: Keypair | null = null;
    private balanceSOL: number | null = null;
    private portfolioSettings: PortfolioSettings | null = null;
    private portfolioStats: PortfolioStats | null = null;

    //private connection: Connection = new MagicConnection({ rpcs: portfolioRpcs, maxRpcs: 3, maxRetries: 15, timeout: 30_000 });
    private connection: Connection = new Connection(appConfig.solana.rpc.helius, { commitment: 'confirmed' });


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
            this.warn(`WALLET_PRIVATE_KEY environment variable is not set`);
            return null;
        }

        try {
            // Convertir la private key en Uint8Array pour créer le Keypair
            const privateKeyBytes = base58.decode(privateKeyString);
            return Keypair.fromSecretKey(privateKeyBytes);

        } catch (err: any) {
            this.error(`Failed to initialize wallet: ${err}`);
            throw new Error('Failed to initialize wallet. Check WALLET_PRIVATE_KEY format.');
        }
    }



    private handleNewTrade(trade: Trade) {
        this.updateHoldingPrice(trade.tokenAddress, trade.price);
    }


    getPortfolio(): Portfolio | null {
        const wallet = this.getWallet();
        if (!wallet) return null;

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
                const newBalanceLamports = await this.connection.getBalance(this.wallet.publicKey, { minContextSlot: this.trading.getLastTradeSlot() })
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

            this.notice(`Nouveau solde SOL: ${balanceSOL}`)
        }
    }


    private async updateTokensHoldings(): Promise<void> {
        if (!this.wallet) {
            this.warn('Cannot fetch tokens from blockchain: wallet not initialized');
            return;
        }

        try {
            this.log('Fetching tokens from blockchain...');

            //const response2 = await this.connection.getTokenAccountsByOwner(
            //    this.wallet.publicKey,
            //    { programId: new PublicKey(PUMPFUN_TOKEN_PROGRAM_ID) }, // Token Program ID
            //    { minContextSlot: this.trading.getLastTradeSlot() }
            //);

            //for (const account of response2.value) {
            //    const accountData = account.account.data;
            //    const decodedData = MintLayout.decode(accountData);
            //    var debugme = decodedData;
            //}


            // Récupérer les tokens du wallet (on-chain)
            const response = await this.connection.getParsedTokenAccountsByOwner(
                this.wallet.publicKey,
                { programId: new PublicKey(PUMPFUN_TOKEN_PROGRAM_ID) } // Token Program ID
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
                //if (amount <= 0.000001) {
                //    if (existingHolding && ! existingHolding.closed) {
                //        this.db.closeTokenHoldingPosition(mintAddress);
                //    }
                //    //continue;
                //}

                //this.log(`Token: ${mintAddress}, Balance: ${amount}`);


                if (!existingHolding) {
                    // Token non suivi, l'ajouter à notre portfolio

                    if (parsedInfo.tokenAmount.uiAmount > 0) {

                        try {
                            // Essayer de récupérer les métadonnées du token
                            let token = this.db.getTokenByAddress(mintAddress);

                            if (!token) {
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

                    } else {
                        // on ne créé pas en local les tokens qui existent on-chain et qui ont une balance de 0
                    }

                } else if (Math.abs(existingHolding.amount - amount) > 0.000_001) {
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
                lastUpdated: new Date(),
                closed: existingHolding.closed || (newCurrentValue < 0.0001 || onchainAmount < 1),
            };

            // Sauvegarder les modifications
            this.db.setTokenHolding(updatedHolding);

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
                transactions: [], // Pas de transactions connues
                closed: false,
            };

            this.db.addTokenHolding(newHolding);
        }
    }


    private async fetchTokenMetadataAndCreateToken(mintAddress: string, ourBalance = 0): Promise<Token | null> {
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

            const curveBalance = totalSupply - ourBalance;
            const curvePercentage = 100 * curveBalance / totalSupply;


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
                boundingCurve: {
                    address: pumpData.bonding_curve,
                    percentage: curvePercentage,
                    solAmount: 0,
                    tokenAmount: curveBalance,
                    completed: pumpData.complete,
                },
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


            // Ajouter notre holding
            if (ourBalance && this.wallet) {
                const meHolder: TokenHolder = {
                    address: this.wallet.publicKey.toBase58(),
                    percentage: 100 * ourBalance / totalSupply,
                    tokenBalance: ourBalance,
                    type: pumpData.creator === this.wallet.publicKey.toBase58() ? 'dev' : 'trader',
                    lastUpdate: new Date,
                    firstBuy: new Date,
                    tokenBalanceMax: ourBalance,
                    tradesCount: 1,
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
        if (!this.portfolioSettings) {
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

        const balance: bigint = await getTokenBalance(this.connection, this.wallet, tokenAddress, this.trading.getLastTradeSlot());
        const tokenBalance = Number(balance) / 1e6;

        const newHolding = this.db.getTokenHolding(tokenAddress);

        if (newHolding) {
            newHolding.amount = tokenBalance;

            this.notice(`Balance du token ${tokenAddress} : ${tokenBalance.toFixed(6)}`);

        } else {
            this.warn(`Holding non trouvé après ${action} ?!`);
        }

        this.emit('portfolio_refreshed');
    }



    // Vérifier s'il faut vendre un token basé sur les conditions de stop loss ou take profit
    checkHoldingsSellConditions(): SellRecommandation[] {
        const settings = this.portfolioSettings;
        const holdings = this.db.getAllHoldings();
        const sellRecommendations: SellRecommandation[] = [];

        if (!settings || !settings.autoSellEnabled) {
            return [];
        }

        for (const holding of holdings) {
            const token = this.db.getTokenByAddress(holding.tokenAddress);
            if (!token) throw new Error(`Token à vendre non trouvé`);

            const recommandation = this.checkTokenSellCondition(token, holding);

            if (recommandation) {
                sellRecommendations.push(recommandation);
            }

        }

        return sellRecommendations;
    }


    checkTokenSellCondition(token: Token, holding: PortfolioHolding): SellRecommandation | null {
        const settings = this.portfolioSettings;
        if (!settings) return null;

        const currentPrice = Number(token.price);
        const buyPrice = holding.avgBuyPrice;
        const minPrice = token.kpis.priceMin;
        const refPrice = Math.max(Number(buyPrice), Number(minPrice))
        const maxPrice = Number(token.kpis.priceMax);

        const priceOffsetUp = Number(maxPrice) - Number(refPrice);
        const percentOfMaxGain = 100 * (currentPrice - Number(refPrice)) / priceOffsetUp;

        const tokenAnalysis = this.db.getTokenAnalysis(holding.tokenAddress);

        let sellRecommendation: SellRecommandation | null = null;

        if (holding.amount * currentPrice < MIN_SELL_SOL_VALUE || holding.amount <= MIN_SELL_TOKEN_AMOUNT) {
            sellRecommendation = {
                tokenAddress: holding.tokenAddress,
                tokenSymbol: holding.tokenSymbol,
                amount: 0, // ne pas vendre
                reason: 'wothless' as const
            };

        } else if (Date.now() - token.lastUpdated.getTime() > 30_000) {
            // Pas d'activité depuis plus de 30 secondes
            sellRecommendation = {
                tokenAddress: holding.tokenAddress,
                tokenSymbol: holding.tokenSymbol,
                amount: holding.amount, // Vendre 100%
                reason: 'abandonned' as const
            };

        } else if (holding.profitLossPercent >= settings.takeProfitPercent) {
            // Take profit
            sellRecommendation = {
                tokenAddress: holding.tokenAddress,
                tokenSymbol: holding.tokenSymbol,
                amount: holding.amount, // Vendre 100% quand on atteint take profit
                reason: 'take_profit' as const
            };

        } else if (holding.profitLossPercent <= -settings.stopLossPercent) {
            // Stop loss
            sellRecommendation = {
                tokenAddress: holding.tokenAddress,
                tokenSymbol: holding.tokenSymbol,
                amount: holding.amount, // Vendre 100% en stop loss
                reason: 'stop_loss' as const
            };

        } else if (percentOfMaxGain < settings.trailingStopPercent) {
            // trailing stop
            sellRecommendation = {
                tokenAddress: holding.tokenAddress,
                tokenSymbol: holding.tokenSymbol,
                amount: holding.amount, // Vendre 100%
                reason: 'trailing_stop' as const
            };

        } else if (tokenAnalysis && tokenAnalysis.tradingSignal.action === 'SELL' && tokenAnalysis.tradingSignal.confidence >= 75) {
            sellRecommendation = {
                tokenAddress: holding.tokenAddress,
                tokenSymbol: holding.tokenSymbol,
                amount: holding.amount, // Vendre 100%
                reason: 'analysis_sell_recommandation' as const
            };

        } else if (token.trends) {
            // TODO: gérer les trends puis implémenter une decision à partir de la trend very_short
        }

        return sellRecommendation;
    }


    canAutoBuyToken(tokenAddress: string, score: number, solAmount?: number): {
        canBuy: boolean,
        reason?: string,
        recommendedAmount?: number
    } {
        const settings = this.portfolioSettings;
        const stats = this.portfolioStats;
        const holdings = this.db.getAllHoldings();

        if (!settings) {
            return { canBuy: false, reason: 'settings manquants' };
        }

        if (!stats) {
            return { canBuy: false, reason: 'stats manquants' };
        }

        let solAmountToInvest = solAmount || settings.defaultBuyAmount;

        // Vérifier si l'achat automatique est activé
        if (!settings.autoBuyEnabled || !solAmountToInvest) {
            return { canBuy: false, reason: 'Auto buy is disabled' };
        }

        // Vérifier le nombre maximum d'investissements simultanés
        const activeHoldings = holdings.filter(holding => !holding.closed && holding.amount >= MIN_SELL_TOKEN_AMOUNT);
        const activeHoldingsCount = activeHoldings.length + this.trading.getPendingBuys();

        if (activeHoldingsCount >= settings.maxConcurrentInvestments) {
            return { canBuy: false, reason: 'Maximum concurrent investments reached' };
        }

        // Vérifier si on a déjà ce token
        const existingHolding = holdings.find(h => h.tokenAddress === tokenAddress);
        if (existingHolding) {
            return { canBuy: false, reason: 'Token already in portfolio' };
        }

        // Vérifier les scores de sécurité et de risque
        if (score < settings.minTokenScore) {
            return { canBuy: false, reason: `Token Score too low (${score}). Required: score > ${settings.minTokenScore}` };
        }

        // Vérifier la limite totale du portefeuille (positions ouvertes)
        if (stats.totalValue + solAmountToInvest > settings.totalPortfolioLimit) {
            solAmountToInvest = settings.totalPortfolioLimit - stats.totalValue;
        }

        // Vérifier le montant maximum par token (pour ce token)
        if (solAmountToInvest > settings.maxSolPerToken) {
            solAmountToInvest = settings.maxSolPerToken;
        }

        return this.canSpendSolAmount(solAmountToInvest);
    }


    // Vérifier si on peut acheter un nouveau token basé sur les conditions actuelles
    canSpendSolAmount(solAmount: number): {
        canBuy: boolean,
        reason?: string,
        recommendedAmount?: number
    } {
        const settings = this.portfolioSettings;
        const stats = this.portfolioStats;

        if (!settings) {
            return { canBuy: false, reason: 'settings manquants' };
        }

        if (!stats) {
            return { canBuy: false, reason: 'stats manquants' };
        }


        // Montant à investir
        let solAmountToInvest = solAmount;


        // Vérifier le solde du wallet avant d'acheter
        const walletBalance = this.getBalanceSOL();
        const availableSolAmount = walletBalance - settings.minSolInWallet;

        if (solAmountToInvest > availableSolAmount) {
            solAmountToInvest = availableSolAmount;
        }

        if (solAmountToInvest < MIN_BUY_SOL_AMOUNT) { // Seuil minimum pour que ça vaille la peine
            return { canBuy: false, reason: `Montant à investir (${solAmountToInvest.toFixed(3)} SOL) trop petit (minimum: ${MIN_BUY_SOL_AMOUNT} SOL)` };
        }


        // Tous les contrôles sont passés
        return { canBuy: true, recommendedAmount: solAmountToInvest };
    }


    canAutoSellToken(tokenAddress: string, tokenAmountToSell?: number): {
        canSell: boolean,
        reason?: string,
        recommendedAmount?: number
    } {
        if (this.trading.getPendingSells() > 0) {
            return { canSell: false, reason: 'Maximum concurrent sells reached' };
        }

        return this.canSpendTokenAmount(tokenAddress, tokenAmountToSell);
    }


    canSpendTokenAmount(tokenAddress: string, tokenAmountToSell?: number): {
        canSell: boolean,
        reason?: string,
        recommendedAmount?: number
    } {

        // Tous les contrôles sont passés
        return { canSell: true, recommendedAmount: tokenAmountToSell };
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
            price: (solAmount / tokenAmount).toFixed(10),
            txHash,
            status: 'pending'
        };

        this.log(`Enregistrement de l'achat du token ${token.address} dans le portfolio`);

        // Vérifier si on a déjà un holding pour ce token
        const holding = this.db.getTokenHolding(token.address);

        if (holding) {
            // Mettre à jour le holding existant
            this.updateHoldingAfterBuy(holding, tokenAmount, solAmount);
            holding.transactions.push(transaction);

        } else {
            // Créer un nouveau holding
            const newHolding: PortfolioHolding = this.createHoldingAfterBuy(token, tokenAmount, solAmount);
            newHolding.transactions.push(transaction);

            this.db.addTokenHolding(newHolding);
        }


        // Mise a jour du solde SOL (en attendant la mise à jour on-chain... qui peut prendre plusieurs secondes)
        this.decreaseBalanceSOL(solAmount);
        this.emit('wallet_update', this.getBalanceSOL());


        // Mettre à jour les statistiques du portefeuille
        this.updateStats();


        // Mise a jour du solde SOL
        await this.updateBalanceSol();
        this.emit('wallet_update', this.getBalanceSOL());


        // mise a jour du solde de tokens (holding. pas les holders)
        await this.updateHoldingBalance(token.address, 'buy');

        this.log(`Balance du token ${token.address} mise à jour après l'achat`);
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
            //if (tokenAmount > 0.9 * holding.amount) {
            //    tokenAmount = holding.amount;
            //} else {
            //    throw new Error(`Insufficient token balance. Have: ${holding.amount}, trying to sell: ${tokenAmount}`);
            //}
        }


        this.log(`Enregistrement de la vente du token ${token.address} dans le portfolio`);

        const transaction: PortfolioTransaction = {
            timestamp: new Date(),
            type: 'sell',
            solAmount,
            tokenAmount,
            price: (solAmount / tokenAmount).toFixed(10),
            txHash,
            status: 'pending'
        };


        // Calculer les nouvelles valeurs
        const newAmount = holding.amount - tokenAmount;

        this.addTransaction(token.address, transaction);


        if (newAmount < 1) {
            // Si on vend tout, on ferme la position
            this.db.closeTokenHoldingPosition(token.address);

        } else {
            this.updateHoldingAfterSell(holding, tokenAmount, solAmount, token.price);
        }


        // Mise a jour du solde SOL (en attendant la mise à jour on-chain... qui peut prendre plusieurs secondes)
        this.increaseBalanceSOL(solAmount);
        this.emit('wallet_update', this.getBalanceSOL());


        // Mettre à jour les statistiques du portefeuille
        this.updateStats();


        // Mise a jour du solde SOL
        await this.updateBalanceSol();
        this.emit('wallet_update', this.getBalanceSOL());


        // mise a jour du solde de tokens (holding. pas les holders)
        await this.updateHoldingBalance(token.address, 'sell');

        this.log(`Balance du token ${token.address} mise à jour après la vente`);

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


    private createHoldingAfterBuy(token: Token, tokenAmount: number, solAmount: number) {
        const tokenPrice = solAmount / tokenAmount;

        // Créer un nouveau holding
        const newHolding: PortfolioHolding = {
            tokenAddress: token.address,
            tokenSymbol: token.symbol,
            tokenName: token.name,
            amount: tokenAmount,
            avgBuyPrice: tokenPrice.toFixed(10),
            totalInvestment: solAmount,
            currentPrice: tokenPrice.toFixed(10),
            currentValue: tokenAmount * Number(token.price),
            profitLoss: (tokenAmount * Number(token.price)) - solAmount,
            profitLossPercent: (((tokenAmount * Number(token.price)) - solAmount) / solAmount) * 100,
            lastUpdated: new Date(),
            transactions: [],
            closed: false,
        };

        return newHolding;
    }


    private updateHoldingAfterBuy(holding: PortfolioHolding, tokenAmount: number, solAmount: number) {
        // Mettre à jour le holding existant (à partir du 2eme buy. ler buy est géré par createHoldingAfterBuy)

        const tokenPrice = solAmount / tokenAmount;

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
            currentPrice: tokenPrice.toFixed(10),
            lastUpdated: new Date,
        };

        Object.assign(holding, update);
    }


    private updateHoldingAfterSell(holding: PortfolioHolding, tokenAmountSold: number, solAmountReceived: number, tokenPrice: string) {
        // Calcul du pourcentage de la position qui est vendue
        const percentageSold = tokenAmountSold / holding.amount;

        // Calculer la part de l'investissement initial que cette vente représente
        const investmentPartSold = holding.totalInvestment * percentageSold;

        // Mettre à jour les valeurs après la vente
        const newAmount = holding.amount - tokenAmountSold;
        const newTotalInvestment = holding.totalInvestment - investmentPartSold;
        const newCurrentValue = newAmount * Number(tokenPrice);
        const newProfitLoss = newCurrentValue - newTotalInvestment;
        const newProfitLossPercent = newTotalInvestment !== 0
            ? (newProfitLoss / newTotalInvestment) * 100
            : 0;

        // Le prix moyen d'achat reste inchangé lors d'une vente
        // car vous vendez à un prix différent, mais cela ne change pas
        // ce que vous avez payé pour les tokens restants

        const update: Partial<PortfolioHolding> = {
            amount: newAmount,
            totalInvestment: newTotalInvestment,
            // avgBuyPrice reste inchangé
            currentValue: newCurrentValue,
            profitLoss: newProfitLoss,
            profitLossPercent: newProfitLossPercent,
            currentPrice: tokenPrice,
            lastUpdated: new Date,
        };

        Object.assign(holding, update);

        // Calculer le P/L réalisé sur cette vente spécifique
        const realizedProfitLoss = solAmountReceived - investmentPartSold;
        const realizedProfitLossPercent = (realizedProfitLoss / investmentPartSold) * 100;

        return {
            realizedProfitLoss,
            realizedProfitLossPercent
        };
    }
}


