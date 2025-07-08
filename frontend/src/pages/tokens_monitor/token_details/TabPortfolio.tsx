// TabPortfolio.tsx

import React, { useContext, useState } from 'react';
import { SocketContext } from '../../../contexts/SocketContext';
import { Portfolio, PortfolioHolding, PortfolioSettings } from '../../../types/server.types';
import { formatAddress, formatPrice } from '../../../utils';


export type PortfolioTabProps = {
    portfolio: Portfolio | null;
    portfolioSettings: PortfolioSettings | null; // objet temporaire pendant l'edition
    portfolioLoading: boolean;
    portfolioError: string | null;
    isPortfolioEditing: boolean;
    setPortfolio: React.Dispatch<React.SetStateAction<Portfolio | null>>;
    setPortfolioSettings: React.Dispatch<React.SetStateAction<PortfolioSettings | null>>;
    setIsPortfolioEditing: React.Dispatch<React.SetStateAction<boolean>>;
    setActiveTab: React.Dispatch<React.SetStateAction<"portfolio" | "tokens" | "trades" | 'system' | 'trending'>>;
    handleTokenSelect: (tokenAddress: string) => void;
}


export const PortfolioTab: React.FC<PortfolioTabProps> = ({ portfolio, portfolioSettings, portfolioLoading, portfolioError, isPortfolioEditing, setPortfolioSettings, setPortfolio, setIsPortfolioEditing, setActiveTab, handleTokenSelect }) => {
    const socket = useContext(SocketContext);
    const [hideSmallBalances, setHideSmallBalances] = useState(true);
    const [minBalanceThreshold, setMinBalanceThreshold] = useState(5_000);

    // Gérer le changement de paramètres
    const handleSettingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!portfolioSettings) return;

        const { name, value, type, checked } = e.target;

        setPortfolioSettings({
            ...portfolioSettings,
            [name]: type === 'checkbox' ? checked : type === 'number' ? parseFloat(value) : value
        });
    };

    // Sauvegarder les paramètres
    const saveSettings = () => {
        if (!socket || !portfolioSettings) return;

        socket.emit('update_portfolio_settings', portfolioSettings);
    };

    // Activer/désactiver le trading automatique
    const toggleAutoTrading = () => {
        if (!socket || !portfolio) return;

        socket.emit('set_auto_trading', !portfolio.autoTrading);
    };

    const gotoTokenDetails = (tokenAddress: string) => {
        handleTokenSelect(tokenAddress);
        setActiveTab('tokens');
    }


    // Fonction pour gérer le changement du checkbox
    const handleHideSmallBalancesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setHideSmallBalances(e.target.checked);
    };

    // Fonction pour gérer le changement du seuil minimum
    const handleMinBalanceThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setMinBalanceThreshold(Number(e.target.value) || 0);
    };


    if (portfolioLoading) {
        return <div className="loading-portfolio">Loading portfolio data...</div>;
    }

    if (portfolioError) {
        return <div className="portfolio-error">{portfolioError}</div>;
    }

    if (!portfolio) {
        return <div className="no-portfolio">Portfolio data not available</div>;
    }

    const filteredHoldings = portfolio.holdings
        ? portfolio.holdings.filter(holding => !hideSmallBalances || holding.amount >= minBalanceThreshold)
        : [];


    return (
        <div className="portfolio-tab">
            <div className="portfolio-header">
                <div className='d-flex'>
                    <h2>Portfolio</h2>

                    <div className='mt-2 ms-3'>
                        Address:
                        <a href={`https://solscan.io/account/${portfolio.walletAddress}`} style={{ color: 'inherit', textDecoration: 'none' }} target="_blank">{portfolio.walletAddress}</a>
                    </div>
                    <div className='mt-2 ms-3'>
                        Balance: {formatPrice(portfolio.balanceSOL, true, true)}
                    </div>
                </div>

                <div className="portfolio-stats">
                    <div className="stat-item">
                        <span className="stat-label">Total Value:</span>
                        <span className="stat-value">{formatPrice(portfolio.stats.totalValue, true)} SOL</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Total Investment:</span>
                        <span className="stat-value">{formatPrice(portfolio.stats.totalInvestment, true)} SOL</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Profit/Loss:</span>
                        <span className={`stat-value ${portfolio.stats.totalProfitLoss >= 0 ? 'positive' : 'negative'}`}>
                            {formatPrice(portfolio.stats.totalProfitLoss, true)} SOL ({portfolio.stats.totalProfitLossPercent.toFixed(2)}%)
                        </span>
                    </div>
                </div>
            </div>

            <div className="portfolio-content">
                <div className="portfolio-holdings">

                    <div className='d-flex justify-content-between'>
                        <h3>Holdings</h3>

                        <div className="d-flex align-items-center mb-2">
                            <input
                                type="checkbox"
                                id="hideSmallBalances"
                                className="form-check-input me-2"
                                checked={hideSmallBalances}
                                onChange={handleHideSmallBalancesChange}
                            />
                            <label htmlFor="hideSmallBalances" className="form-check-label me-2">
                                Cacher les soldes inférieurs à
                            </label>
                            <input
                                type="number"
                                className="form-control form-control-sm"
                                style={{ width: "80px" }}
                                min="0"
                                value={minBalanceThreshold}
                                onChange={handleMinBalanceThresholdChange}
                                disabled={!hideSmallBalances}
                            />
                            <span className="ms-2">SOL</span>
                        </div>
                    </div>

                    {filteredHoldings.length > 0 ? (
                        <div className="holdings-list">
                            <div className="list-headers">
                                <span className="holding-token">Token</span>
                                <span className="holding-address">Address</span>
                                <span className="holding-amount">Amount</span>
                                <span className="holding-price">Price</span>
                                <span className="holding-value">Value</span>
                                <span className="holding-profit">Profit/Loss</span>
                            </div>
                            <div className="holdings-items">
                                {filteredHoldings.map((holding: PortfolioHolding) => (
                                    <div key={holding.tokenAddress} className="holding-item">
                                        <span className="holding-token">{holding.tokenSymbol}</span>
                                        <span className="holding-address" onClick={() => gotoTokenDetails(holding.tokenAddress)}>
                                            {formatAddress(holding.tokenAddress)}
                                        </span>
                                        <span className="holding-amount">{holding.amount.toFixed(3)}</span>
                                        <span className="holding-price">{holding.currentPrice}</span>
                                        <span className="holding-value">{formatPrice(holding.currentValue, true)} SOL</span>
                                        <span className={`holding-profit ${holding.profitLoss >= 0 ? 'positive' : 'negative'}`}>
                                            {holding.profitLoss.toFixed(3)} SOL ({holding.profitLossPercent?.toFixed(2)}%)
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="no-holdings">No holdings in portfolio</div>
                    )}
                </div>

                <div className="portfolio-settings">
                    <div className="settings-header">
                        <h3>Settings</h3>
                        {!isPortfolioEditing ? (
                            <button className="edit-btn" onClick={() => setIsPortfolioEditing(true)}>Edit</button>
                        ) : (
                            <div className="settings-actions">
                                <button className="save-btn" onClick={saveSettings}>Save</button>
                                <button className="cancel-btn" onClick={() => {
                                    setIsPortfolioEditing(false);
                                    setPortfolioSettings(portfolio.settings);
                                }}>Cancel</button>
                            </div>
                        )}
                    </div>

                    {portfolioSettings && (
                        <div className="settings-form">
                            <div className='d-flex justify-content-around'>
                                <div className="form-group">
                                    <label>
                                        <input
                                            type="checkbox"
                                            name="autoBuyEnabled"
                                            checked={portfolioSettings.autoBuyEnabled}
                                            onChange={handleSettingChange}
                                            disabled={!isPortfolioEditing}
                                        />
                                        Auto Buy Enabled
                                    </label>
                                </div>

                                <div className="form-group">
                                    <label>
                                        <input
                                            type="checkbox"
                                            name="autoSellEnabled"
                                            checked={portfolioSettings.autoSellEnabled}
                                            onChange={handleSettingChange}
                                            disabled={!isPortfolioEditing}
                                        />
                                        Auto Sell Enabled
                                    </label>
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Default Buy Amount (SOL):</label>
                                <input
                                    type="number"
                                    name="defaultBuyAmount"
                                    value={portfolioSettings.defaultBuyAmount.toFixed(3)}
                                    onChange={handleSettingChange}
                                    disabled={!isPortfolioEditing}
                                    step="0.01"
                                    min="0"
                                />
                            </div>

                            <div className="form-group">
                                <label>Min Token Score (autoBuy):</label>
                                <input
                                    type="number"
                                    name="minTokenScore"
                                    value={portfolioSettings.minTokenScore}
                                    onChange={handleSettingChange}
                                    disabled={!isPortfolioEditing}
                                    step="0.01"
                                    min="0"
                                />
                            </div>

                            <div className="form-group">
                                <label>Max SOL Per Token:</label>
                                <input
                                    type="number"
                                    name="maxSolPerToken"
                                    value={portfolioSettings.maxSolPerToken.toFixed(3)}
                                    onChange={handleSettingChange}
                                    disabled={!isPortfolioEditing}
                                    step="0.01"
                                    min="0"
                                />
                            </div>

                            <div className="form-group">
                                <label>Max Concurrent Investments:</label>
                                <input
                                    type="number"
                                    name="maxConcurrentInvestments"
                                    value={portfolioSettings.maxConcurrentInvestments}
                                    onChange={handleSettingChange}
                                    disabled={!isPortfolioEditing}
                                    step="1"
                                    min="1"
                                />
                            </div>

                            <div className="form-group">
                                <label>Total Portfolio Limit:</label>
                                <input
                                    type="number"
                                    name="totalPortfolioLimit"
                                    value={portfolioSettings.totalPortfolioLimit.toFixed(3)}
                                    onChange={handleSettingChange}
                                    disabled={!isPortfolioEditing}
                                    step="0.001"
                                    min="0.001"
                                />
                            </div>

                            <div className="form-group">
                                <label>Min SOL in Wallet:</label>
                                <input
                                    type="number"
                                    name="minSolInWallet"
                                    value={portfolioSettings.minSolInWallet.toFixed(3)}
                                    onChange={handleSettingChange}
                                    disabled={!isPortfolioEditing}
                                    step="0.01"
                                    min="0"
                                />
                            </div>

                            <div className="form-group">
                                <label>Take Profit (%):</label>
                                <input
                                    type="number"
                                    name="takeProfitPercent"
                                    value={portfolioSettings.takeProfitPercent}
                                    onChange={handleSettingChange}
                                    disabled={!isPortfolioEditing}
                                    step="1"
                                    min="0"
                                />
                            </div>

                            <div className="form-group">
                                <label>Stop Loss (%):</label>
                                <input
                                    type="number"
                                    name="stopLossPercent"
                                    value={portfolioSettings.stopLossPercent}
                                    onChange={handleSettingChange}
                                    disabled={!isPortfolioEditing}
                                    step="1"
                                    min="0"
                                />
                            </div>

                            <div className="form-group">
                                <label>Trailing Stop (%):</label>
                                <input
                                    type="number"
                                    name="trailingStopPercent"
                                    value={portfolioSettings.trailingStopPercent}
                                    onChange={handleSettingChange}
                                    disabled={!isPortfolioEditing}
                                    step="1"
                                    min="0"
                                />
                            </div>
                        </div>
                    )}

                    <div className="auto-trading-control">
                        <h4>Auto Trading</h4>
                        <button
                            className={`auto-trading-btn ${portfolio.autoTrading ? 'enabled' : 'disabled'}`}
                            onClick={toggleAutoTrading}
                        >
                            {portfolio.autoTrading ? 'Enabled' : 'Disabled'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};