// tokens_monitor.tsx

import React, { useContext, useEffect, useState } from 'react';

import '../assets/TokensMonitor.css';
import '../assets/TokensMonitorLists.css';
import '../assets/TokensMonitorTokensList.css';
import '../assets/TokensMonitorTradesList.css';
import '../assets/TokensMonitorTokenDetails.css';
import '../assets/TokensMonitorTokenDetails_buysell.css';
import '../assets/TokensMonitorTokenDetails_chart.css';
import '../assets/TokensMonitorPortfolio.css';
import '../assets/TabTrades.css';
import '../assets/SystemTab.css';

import { SocketContext } from '../contexts/SocketContext';
import { TokenDetails } from './tokens_monitor/TokenDetails';
import { TradesList } from './tokens_monitor/TradesList';
import { TokensList } from './tokens_monitor/TokensList';

import { PortfolioTab } from './tokens_monitor/token_details/TabPortfolio';
import { SystemTab } from './tokens_monitor/token_details/SystemTab';
import { MAX_TOKENS, MAX_TRADES } from '../config';

import type { TokenAnalysis, Token, Trade, TokenDetailData, Portfolio, PortfolioSettings, ServerStats, PortfolioHolding } from '../types/server.types';



export const TokensMonitor: React.FC = () => {
    const socket = useContext(SocketContext);
    // States
    const [tokens, setTokens] = useState<Token[]>([]);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [selectedToken, setSelectedToken] = useState<string | null>(null);
    const [tokenDetails, setTokenDetails] = useState<TokenDetailData | null>(null);
    const [activeTab, setActiveTab] = useState<'tokens' | 'trades' | 'portfolio' | 'system' | 'trending'>('tokens');
    const [loadingDetails, setLoadingDetails] = useState<boolean>(false);
    const [socketError, setSocketError] = useState<string | null>(null);
    const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
    const [portfolioLoading, setPortfolioLoading] = useState<boolean>(true);
    const [portfolioError, setPortfolioError] = useState<string | null>(null);
    const [portfolioSettings, setPortfolioSettings] = useState<PortfolioSettings | null>(null);
    const [isPortfolioEditing, setIsPortfolioEditing] = useState<boolean>(false);
    const [serverStats, setServerStats] = useState<ServerStats | null>(null);


    // Écouteurs d'événements principaux
    useEffect(() => {
        if (!socket) return;

        // Gestion des erreurs
        socket.on('error', (data: { message: string }) => {
            console.error("Server error:", data.message);
            setSocketError(data.message);
        });

        socket.on('connect', () => {
            setSocketError(null);
        });

        socket.on('connect_error', () => {
            setSocketError("Erreur de connexion au serveur");
        });

        // Réception des données initiales
        socket.on('initial_tokens', (initialTokens: Token[]) => {
            setTokens(initialTokens);
        });


        // Création de token
        socket.on('token_create', (tokenData: Token) => {
            console.log(`New token created: ${tokenData.address} => ${tokenData.symbol}`);

            setTokens(prev => {
                // Récupérer tous les tokens qui sont dans le portfolio (holdés)
                const holdedTokens = prev.filter(token =>
                    portfolio?.holdings?.some(holding => holding.tokenAddress === token.address)
                );

                // Vérifier si le nouveau token n'est pas déjà dans la liste
                const tokenExists = prev.some(token => token.address === tokenData.address);
                if (tokenExists) {
                    // Mettre à jour le token existant
                    return prev.map(token =>
                        token.address === tokenData.address ? tokenData : token
                    );
                }

                // Créer un nouvel array avec:
                // 1. Le nouveau token
                // 2. Tous les tokens holdés (même s'ils sont anciens)
                // 3. Les tokens restants jusqu'à atteindre MAX_TOKENS
                const updatedTokens = [
                    tokenData,
                    ...prev.filter(token =>
                        !holdedTokens.some(held => held.address === token.address) &&
                        token.address !== tokenData.address
                    )
                ];

                // Limiter le nombre total de tokens tout en conservant les tokens holdés
                return updatedTokens.slice(0, MAX_TOKENS);
            });
        });


        // Mise à jour d'un token
        socket.on('token_update', (tokenData: Token) => {
            //console.log('token_update 1')

            setTokens(prev =>
                prev.map(token =>
                    token.address === tokenData.address ? tokenData : token
                )
            );

            if (portfolio) {
                const holding = portfolio.holdings.find(holding => holding.tokenAddress === tokenData.address);

                if (holding) {
                    const newTotalTokens = holding.amount;
                    const newTotalInvestment = holding.totalInvestment;
                    const tokenPrice = tokenData.price;
                    const newCurrentValue = newTotalTokens * Number(tokenPrice);
                    const newProfitLoss = newCurrentValue - newTotalInvestment;
                    const newProfitLossPercent = (newProfitLoss / newTotalInvestment) * 100;

                    const holdingUpdated: PortfolioHolding = {
                        ...holding,
                        currentValue: newCurrentValue,
                        profitLoss: newProfitLoss,
                        profitLossPercent: newProfitLossPercent,
                        currentPrice: tokenPrice,
                        lastUpdated: new Date,

                    };

                    const holdings = portfolio.holdings.filter(holding => holding.tokenAddress !== tokenData.address);
                    holdings.push(holdingUpdated);

                    setPortfolio({
                        ...portfolio,
                        holdings,
                    });
                }
            }
        });


        socket.emit('get_initial_data');


        const handlePortfolioData = (portfolio: Portfolio) => {
            console.log('[handlePortfolioData] portfolio:', portfolio)
            setPortfolio(portfolio);
            setPortfolioSettings(portfolio.settings);
            setPortfolioLoading(false);
        };

        const handleSettingsUpdated = (response: { success: boolean }) => {
            if (response.success) {
                setIsPortfolioEditing(false);
                // Recharger les données du portfolio
                socket.emit('get_portfolio_data');
            }
        };

        const handleWalletUpdated = (balanceSOL: number) => {
            if (!portfolio) return;
            console.log('PortfolioTab: Wallet updated with balance:', balanceSOL);
            setPortfolio({
                ...portfolio,
                balanceSOL,
            });
        };

        socket.on('wallet_update', handleWalletUpdated); // TODO: deplacer l'ecouteur dans TokensMonitor afin de ne pas perdre l'info a chaque changement de tab
        socket.on('portfolio_data', handlePortfolioData);
        socket.on('settings_updated', handleSettingsUpdated); // TODO: deplacer les ecouteurs portfolio aussi dans TokensMonitor
        //socket.on('portfolio_update', handlePortfolioUpdated); .. TODO => event recu = { type: 'buy' | 'sell', tokenAddress: string, tokenAmount: number, solAmount: number }

        socket.on('portfolio_error', (err: any) => {
            setPortfolioError(err.message);
            setPortfolioLoading(false);
        });

        socket.on('auto_trading_updated', (result: { enabled: boolean }) => {
            console.log('[auto_trading_updated] result:', result)
            setPortfolio(currentPortfolio => {
                if (!currentPortfolio) return null;
                return { ...currentPortfolio, autoTrading: result.enabled };
            });
        });

        socket.on('server_stats', (serverStats: ServerStats) => {
            setServerStats(serverStats);
        });


        // Demander les données du portfolio
        socket.emit('get_portfolio_data');


        return () => {
            socket.off('error');
            socket.off('connect');
            socket.off('connect_error');
            socket.off('initial_tokens');
            socket.off('token_create');
            socket.off('token_update');
            socket.off('buy');
            socket.off('sell');
            socket.off('wallet_update', handleWalletUpdated);
            socket.off('portfolio_data', handlePortfolioData);
            socket.off('settings_updated', handleSettingsUpdated);
            //socket.off('portfolio_update', handlePortfolioUpdated); // TODO
            socket.off('portfolio_error');
            socket.off('auto_trading_updated');
            socket.off('server_stats');
        };
    }, [socket]);


    // Écouteurs spécifiques au token sélectionné
    useEffect(() => {
        if (!socket) return;

        // Ces événements sont spécifiques au token sélectionné
        const handleTokenUpdate = (tokenData: Token) => {
            //console.log('token_update 2')

            if (selectedToken === tokenData.address) {
                setTokenDetails(prevDetails => {
                    if (!prevDetails) return null;
                    return { ...prevDetails, ...tokenData };
                });
            }

            const trade = tokenData.trades.at(-1);

            if (trade) {
                setTrades((trades) => [ trade, ...trades ]);
            }
        };

        const handleAnalyticsUpdate = (analytics: TokenAnalysis) => {
            if (selectedToken === analytics.tokenAddress) {
                setTokenDetails(prevDetails => {
                    if (!prevDetails) return null;

                    return {
                        ...prevDetails,
                        analytics,
                    };
                });
            }
        };

        const handleTokenDetails = (details: TokenDetailData) => {
            if (selectedToken === details.address) {
                setTokenDetails(details);
                setLoadingDetails(false);
            }
        };

        // Ajouter les écouteurs spécifiques
        socket.on('token_update', handleTokenUpdate);
        socket.on('analytics_update', handleAnalyticsUpdate);
        socket.on('token_details', handleTokenDetails);

        return () => {
            // Retirer les écouteurs spécifiques
            socket.off('token_update', handleTokenUpdate);
            socket.off('analytics_update', handleAnalyticsUpdate);
            socket.off('token_details', handleTokenDetails);
        };
    }, [socket, selectedToken]);


    // Gestion de la sélection d'un token
    const handleTokenSelect = (tokenAddress: string) => {
        console.log(`Selecting token: ${tokenAddress}`);
        setSelectedToken(tokenAddress);
        setLoadingDetails(true);
        setTokenDetails(null);

        if (socket) {
            socket.emit('get_token_details', tokenAddress);
        }
    };

    const chooseToken = () => {
        const tokenAddress = prompt("Adresse du token à consulter :");
        if (tokenAddress) {
            handleTokenSelect(tokenAddress);
        }
    }

    return (
        <div className="tokens-monitor">
            {socketError && <div className="error-banner">{socketError}</div>}

            <div className="monitor-header">
                <h1>PUMP.FUN MONITOR</h1>

                <div className="tabs">
                    <button
                        className={""}
                        onClick={() => chooseToken()}
                    >
                        Select Token
                    </button>
                    <button
                        className={activeTab === 'portfolio' ? 'active' : ''}
                        onClick={() => setActiveTab('portfolio')}
                    >
                        Portfolio
                    </button>
                    <button
                        className={activeTab === 'tokens' ? 'active' : ''}
                        onClick={() => setActiveTab('tokens')}
                    >
                        Tokens
                    </button>
                    <button
                        className={activeTab === 'trades' ? 'active' : ''}
                        onClick={() => setActiveTab('trades')}
                    >
                        Trades
                    </button>
                    <button
                        className={activeTab === 'trending' ? 'active' : ''}
                        onClick={() => setActiveTab('trending')}
                    >
                        Trending
                    </button>
                    <button
                        className={activeTab === 'system' ? 'active' : ''}
                        onClick={() => setActiveTab('system')}
                    >
                        System
                    </button>
                </div>
            </div>

            <div className="monitor-container">
                {(activeTab === 'tokens' || activeTab === 'trades') && (
                    <>
                        <div className="lists-panel">
                            {activeTab === 'tokens' ? (
                                <TokensList tokens={tokens} selectedToken={selectedToken} handleTokenSelect={handleTokenSelect} />
                            ) : (
                                <TradesList tokens={tokens} trades={trades} selectedToken={selectedToken} handleTokenSelect={handleTokenSelect} />
                            )}
                        </div>
                        <div className="detail-panel">
                            {selectedToken ? (
                                loadingDetails ? (
                                    <div className="loading">Loading token details...</div>
                                ) : (
                                    tokenDetails ? (
                                        <TokenDetails tokenDetails={tokenDetails} portfolio={portfolio} />
                                    ) : (
                                        <div className="no-selection">Token details not available</div>
                                    )
                                )
                            ) : (
                                <div className="no-selection">Select a token to view details</div>
                            )}
                        </div>
                    </>
                )}

                {activeTab === 'portfolio' && (
                    <div className="portfolio-container">
                        <PortfolioTab
                            portfolio={portfolio}
                            portfolioSettings={portfolioSettings}
                            setPortfolio={setPortfolio}
                            setPortfolioSettings={setPortfolioSettings}
                            portfolioLoading={portfolioLoading}
                            portfolioError={portfolioError}
                            isPortfolioEditing={isPortfolioEditing}
                            setIsPortfolioEditing={setIsPortfolioEditing}
                            setActiveTab={setActiveTab}
                            handleTokenSelect={handleTokenSelect}
                        />
                    </div>
                )}

                {activeTab === 'trending' && (
                    <div className="fame-container">
                        <TrendingTab tokens={tokens} />
                    </div>
                )}

                {activeTab === 'system' && (
                    <div className="system-container">
                        <SystemTab serverStats={serverStats} tokens={tokens} />
                    </div>
                )}
            </div>
        </div>
    );
};



export type TrendingTabProps = {
    tokens: Token[];
}


export const TrendingTab: React.FC<TrendingTabProps> = ({ tokens }) => {
    return (
        <>
            <pre>
                {`
                Afficher ici : 
                - les tokens ayant des milestones
                - les tokens ayant bcp de trades / bcp de volume
                - les tokens ayant une forte evolution du prix
                - les tokens ayant une forte evolution des holders
                `}
            </pre>
        </>
    );
};

