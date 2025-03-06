// WebApp.service.ts

import express from 'express';
import cors from 'cors';
import http from 'http';
import { DefaultEventsMap, Server as SocketIOServer, Socket } from 'socket.io';

import { ServiceAbstract } from "./abstract.service";
import { Token, Trade } from '../models/Token.model';
import { TokenAnalysis } from '../models/TokenAnalysis.model';
import { OpportunityAnalysis } from '../analyzers/opportunity-analyzer';
import { PortfolioHolding } from '../models/Portfolio.model';
import { TradingResult } from './Trading.service';
import { SelectItemsOptions } from '../lib/utils/model.util';

/* ######################################################### */

type SocketIO = SocketIOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>;


export interface TokenDetailData extends Token {
    holding?: PortfolioHolding | null;
    analytics?: TokenAnalysis | null;
}


export interface TradeResult {
    success?: boolean;
    message: string;
    tokenAmount?: number;
    solAmount?: number;
    error?: string;
}


export type ServerStats = {
    tokens: number,
    tokensMax: number | null,
    cpuUsage: number, // percent
    cpuLoad: number,
    ramUsage: number, // percent
    uptime: number,
    lastUpdate: Date,
}


/* ######################################################### */

const SERVER_MAX_TOKENS = 10_000;
const CLIENT_MAX_TOKENS = 200;

/* ######################################################### */


export class WebApp extends ServiceAbstract {
    private io: SocketIO | null = null;
    private server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse> | null = null;


    start() {
        if (this.status !== 'stopped') return;
        super.start();


        // start express http server
        this.server = this.startWebserver();

        // start socket.io server
        this.io = this.startSocketIoServer(this.server);


        this.tokenManager.on('new_token_added', this.handleNewToken.bind(this))
        this.tokenManager.on('new_trade_added', this.handleNewTrade.bind(this))
        this.tokenAnalyzer.on('token_analysis_added', this.handleNewTokenAnalysis.bind(this))
        this.tokenAnalyzer.on('token_analysis_updated', this.handleTokenAnalysisUpdate.bind(this))


        super.started();
    }


    async stop() {
        if (this.status !== 'started') return;
        super.stop();


        if (this.io) {
            await this.io.close();
            this.io = null;
        }

        if (this.server) {
            this.server.closeAllConnections();
            this.server.close();
            this.server = null;
        }

        this.tokenManager.off('new_token_added', this.handleNewToken.bind(this))
        this.tokenManager.off('new_trade_added', this.handleNewTrade.bind(this))
        this.tokenAnalyzer.off('token_analysis_added', this.handleNewTokenAnalysis.bind(this))
        this.tokenAnalyzer.off('token_analysis_updated', this.handleTokenAnalysisUpdate.bind(this))


        super.stopped();
    }


    startWebserver(): http.Server<typeof http.IncomingMessage, typeof http.ServerResponse> {
        const app = express();
        const PORT = process.env.PORT || 3000;

        app.use(cors());
        app.use(express.json());


        // Endpoint pour récupérer tous les tokens
        app.get("/api/tokens", async (req, res) => {
            try {
                const sortCriteria = req.query.sortCriteria?.toString() as keyof Token;
                const sortOrder = req.query.sortOrder?.toString() === 'desc' ? 'desc' : 'asc';
                const limit = Number(req.query.limit) || 100;

                const selectOptions: SelectItemsOptions<Token> = {
                    sortCriteria,
                    sortOrder,
                    limit,
                };

                const tokens: Token[] = this.db.selectTokens(selectOptions);
                res.json(tokens);

            } catch (err) {
                res.status(500).json({ error: "Erreur serveur" });
            }
        });


        // Endpoint pour récupérer un token par son adresse
        app.get("/api/tokens/:address", async (req, res) => {
            try {
                const token: Token | null = this.db.getTokenByAddress(req.params.address);

                if (!token) {
                    res.status(404).json({ error: "Token non trouvé" });
                    return;
                }

                res.json(token);

            } catch (err) {
                res.status(500).json({ error: "Erreur serveur" });
            }
        });


        const server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse> = app.listen(PORT, () => {
            this.log(`✔️ Serveur web démarré sur le port ${PORT}`);
        });

        return server;
    }



    startSocketIoServer(server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>): SocketIO {
        // Configurer Socket.IO
        const io = new SocketIOServer(server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });

        // Écouter les connexions Socket.IO
        io.on('connection', this.handleSocketIoConnection.bind(this));

        return io;
    }


    handleSocketIoConnection(socket: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>) {
        this.log(`Client connected: ${socket.id}`);

        // Gestion d'evenements recu par la WebApp
        socket.on('get_initial_data', async () => {
            try {
                this.log('Fetching initial data...');

                // Récupérer les tokens
                const tokens = this.db.selectTokens({
                    sortCriteria: 'createdAt',
                    sortOrder: 'desc',
                    limit: CLIENT_MAX_TOKENS,
                });


                this.log(`Sending initial data: ${tokens.length} tokens`);

                // Envoyer les données au client
                socket.emit('initial_tokens', tokens);


                const balanceSOL = this.portfolio.getBalanceSOL() ?? null;
                socket.emit('wallet_update', balanceSOL);

                const serverStats = this.getServerStats();
                socket.emit('server_stats', serverStats);

            } catch (err: any) {
                this.error(`Error fetching initial data: ${err.message}`);
                socket.emit('error', { message: 'Failed to fetch initial data' });
            }
        });


        // Récupérer les données du portfolio
        socket.on('get_portfolio_data', async () => {
            if (!this.portfolio || !this.trading) {
                socket.emit('error', { message: 'Portfolio manager not available' });
                return;
            }

            try {
                const portfolio = this.portfolio.getPortfolio();
                socket.emit('portfolio_data', portfolio);

            } catch (err: any) {
                this.error(`Error getting portfolio data: ${err.message}`);
                socket.emit('error', { message: 'Failed to get portfolio data' });
            }
        });



        // Acheter un token
        socket.on('buy_token', async (tokenAddress: string, solAmount: number) => {
            if (!this.trading) {
                socket.emit('error', { message: 'Trading service not available' });
                return;
            }

            try {
                const token = this.db.getTokenByAddress(tokenAddress);

                if (!token) {
                    socket.emit('error', { message: `Token ${tokenAddress} not found` });
                    return;
                }

                const result: TradingResult = await this.trading.buyToken(token, solAmount);

                if (result.success) {
                    this.log(`Bought ${result.tokenAmount} ${token.symbol} for ${result.solAmount} SOL`);

                    this.emitPortfolioUpdate({ type: 'buy', tokenAddress: token.address, tokenAmount: result.tokenAmount, solAmount: result.solAmount })

                    socket.emit('trade_result', { success: true, message: `Bought ${result.tokenAmount} ${token.symbol}` } as TradeResult);

                } else {
                    socket.emit('trade_result', { success: false, message: result.error } as TradeResult);
                }

            } catch (err: any) {
                this.error(`Error buying token ${tokenAddress}: ${err.message}`);
                socket.emit('error', { message: `Failed to buy token: ${err.message}` } as TradeResult);
            }
        });


        // Vendre un token
        socket.on('sell_token', async (tokenAddress: string, tokenAmount: number) => {
            if (!this.trading) {
                socket.emit('error', { message: 'Trading service not available' });
                return;
            }

            try {
                const token = this.db.getTokenByAddress(tokenAddress);

                if (!token) {
                    socket.emit('error', { message: `Token ${tokenAddress} not found` });
                    return;
                }

                const result = await this.trading.sellToken(token, tokenAmount);

                if (result.success) {
                    this.log(`Sold ${result.tokenAmount} ${token.symbol} for ${result.solAmount} SOL`);

                    this.emitPortfolioUpdate({ type: 'sell', tokenAddress: token.address, tokenAmount: result.tokenAmount, solAmount: result.solAmount })

                    socket.emit('trade_result', { success: true, message: `Sold ${result.tokenAmount} ${token.symbol}` });

                } else {
                    socket.emit('trade_result', { success: false, message: result.error });
                }

            } catch (err: any) {
                this.error(`Error selling token ${tokenAddress}: ${err.message}`);
                socket.emit('error', { message: `Failed to sell token: ${err.message}` });
            }
        });


        // Mettre à jour les paramètres du portfolio
        socket.on('update_portfolio_settings', async (newSettings: any) => {
            if (!this.portfolio) {
                socket.emit('error', { message: 'Portfolio manager not available' });
                return;
            }

            try {
                this.portfolio.updateSettings(newSettings);
                this.log('Portfolio settings updated');
                socket.emit('settings_updated', { success: true });

            } catch (err: any) {
                this.error(`Error updating portfolio settings: ${err.message}`);
                socket.emit('error', { message: `Failed to update settings: ${err.message}` });
            }
        });


        // Activer/désactiver le trading automatique
        socket.on('set_auto_trading', async (enabled: boolean) => {
            if (!this.trading) {
                socket.emit('error', { message: 'Trading service not available' });
                return;
            }

            this.trading.setAutoTrading(enabled);
            socket.emit('auto_trading_updated', { enabled });
        });


        // Gestionnaire pour les détails d'un token spécifique
        socket.on('get_token_details', (tokenAddress: string) => {
            this.emitTokenDetails(tokenAddress, socket);
        });


        socket.on('disconnect', () => {
            this.log(`Client disconnected: ${socket.id}`);
        });
    }


    getServerStats(): ServerStats {
        const tokens = this.db.getTokensCount()

        const systemMetrics = this.systemMonitor.getMetrics();

        const serverStats: ServerStats = {
            tokens,
            tokensMax: SERVER_MAX_TOKENS,
            cpuUsage: systemMetrics?.cpu.processUsagePercent ?? 0,
            cpuLoad: Number(systemMetrics?.cpu.systemAverageLoad.load1 ?? 0),
            ramUsage: systemMetrics?.memory.systemUsagePercent ?? 0,
            uptime: process.uptime(),
            lastUpdate: new Date,
        };

        return serverStats;
    }


    handleNewToken(token: Token) {
        this.emitTokenCreation(token);
    }


    handleNewTrade(trade: Trade) {
        const token = this.db.getTokenByAddress(trade.tokenAddress);

        if (token) {
            this.emitTokenUpdate(token);
        }
    }


    handleNewTokenAnalysis(analysis: TokenAnalysis) {
        this.emitAnalyticsUpdate(analysis);
    }


    handleTokenAnalysisUpdate(analysis: TokenAnalysis) {
        this.emitAnalyticsUpdate(analysis);
    }



    // Emission d'evenements à destination de la WebApp

    emitServerStats() {
        if (!this.io) return;
        const serverStats = this.getServerStats();
        this.io.emit('server_stats', serverStats);
    }


    emitTokenCreation(newToken: Token) {
        if (!this.io) return;
        this.io.emit('token_create', newToken);
    }


    emitTokenTrade(trade: Trade) {
        if (!this.io) return;
        this.io.emit(trade.type, trade);
    }


    emitBuyOpportunity(opportunity: OpportunityAnalysis) {
        if (!this.io) return;
        this.io.emit('buy_opportunity', opportunity);
    }


    emitTokenUpdate(updatedToken: Token) {
        if (!this.io) return;
        this.io.emit('token_update', updatedToken);
    }


    emitTokenAlert(token: Token, tokenAmount: number) {
        if (!this.io) return;
        this.io.emit('token_alert', {
            type: 'large_sell',
            tokenAddress: token.address,
            tokenSymbol: token.symbol,
            amount: tokenAmount,
            percentage: tokenAmount / token.totalSupply * 100,
        });
    }


    emitAnalyticsUpdate(tokenAnalysis: TokenAnalysis) {
        if (!this.io) return;
        // Émettre l'analyse complète, avec mapping pour compatibilité frontend
        this.io.emit('analytics_update', tokenAnalysis);
    }


    emitPortfolioUpdate(portfolioUpdate: { type: 'buy' | 'sell', tokenAddress: string, tokenAmount: number, solAmount: number }) {
        if (!this.io) return;
        this.io.emit('portfolio_update', portfolioUpdate);
    }


    emitWalletUpdate(balanceSOL: number) {
        if (!this.io) return;
        this.io.emit('wallet_update', balanceSOL);
    }


    /** Émet les détails complets d'un token et son analyse */
    emitTokenDetails(tokenAddress: string, socket: Socket): void {
        try {
            this.log(`Fetching details for token: ${tokenAddress}`);

            // Récupérer les données de base du token
            const token = this.db.getTokenByAddress(tokenAddress);

            if (!token) {
                this.log(`Token not found: ${tokenAddress}`);
                socket.emit('error', { message: 'Token not found' });
                return;
            }

            // Récupérer l'analyse du token depuis tokenAnalyzer
            const tokenAnalysis = this.db.getTokenAnalysis(tokenAddress);

            // Récupérer les holdings pour ce token s'ils existent
            let holding = null;
            if (this.portfolio) {
                holding = this.db.getTokenHolding(tokenAddress);
            }

            // Construire l'objet de détails enrichi
            const tokenDetails: TokenDetailData = {
                ...token,
                holding,
                analytics: tokenAnalysis,
            };

            this.log(`Sending token details for: ${token.name} (${token.symbol})`);

            // Envoyer les détails au client
            socket.emit('token_details', tokenDetails);

        } catch (err: any) {
            this.error(`Error fetching token details for ${tokenAddress}: ${err.message}`);
            socket.emit('error', { message: 'Failed to fetch token details' });
        }
    }

}


