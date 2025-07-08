// TabManualTrading.tsx

import { useState } from "react";
import { formatPrice, getRecommendationInfo } from "../../../utils";

import type { Portfolio, TokenDetailData } from "../../../types/server.types";

export type TabManualTradingProps = {
    tokenDetails: TokenDetailData,
    portfolio: Portfolio | null,
    tradeType: "buy" | "sell",
    tradeAmount: string,
    tradeStatus: {
        message: string;
        success?: boolean;
    } | null,
    handleTradeSubmit: (e: React.FormEvent) => void,
    setTradeType: React.Dispatch<React.SetStateAction<"buy" | "sell">>,
    setTradeAmount: React.Dispatch<React.SetStateAction<string>>,
}

export const TabManualTrading: React.FC<TabManualTradingProps> = ({
    tokenDetails,
    portfolio,
    tradeType,
    tradeAmount,
    tradeStatus,
    handleTradeSubmit,
    setTradeType,
    setTradeAmount
}) => {
    // États séparés pour les montants d'achat et de vente
    const [buyAmount, setBuyAmount] = useState<string>(tradeAmount);
    const [sellAmount, setSellAmount] = useState<string>("0");

    // Gestionnaire de changement de type de transaction
    const handleTradeTypeChange = (type: "buy" | "sell") => {
        setTradeType(type);
        // Mettre à jour le montant global en fonction du type sélectionné
        setTradeAmount(type === "buy" ? buyAmount : sellAmount);
    };

    // Gestionnaire de changement de montant
    const handleAmountChange = (value: string) => {
        value = value.replace(',', '.');
        const parts = value.split('.');

        if (tradeType === "buy") {
            value = parts.length === 1 ? value : `${parts[0]}.${parts[1].slice(0, 9)}`;
            setBuyAmount(value);
            setTradeAmount(value);

        } else {
            value = parts.length === 1 ? value : `${parts[0]}.${parts[1].slice(0, 6)}`;
            setSellAmount(value);
            setTradeAmount(value);
        }
    };

    // Fonction pour définir le montant maximum
    const setMaxAmount = (percent = 100) => {
        if (tradeType === "buy" && portfolio) {
            // Pour l'achat, le max est le solde SOL disponible (moins un petit tampon)
            const maxAllowed = portfolio.balanceSOL - 0.005;
            const maxBuy = Math.max(0, percent * maxAllowed / 100).toFixed(3);
            handleAmountChange(maxBuy);

        } else if (tradeType === "sell" && tokenDetails.holding) {
            // Pour la vente, le max est le solde du token
            const maxAllowed = tokenDetails.holding.amount;
            const maxSell = (percent * maxAllowed / 100).toString();
            handleAmountChange(maxSell);
        }
    };

    return (
        <div className="token-trade">
            <h3>Trade {tokenDetails.symbol}</h3>

            <div className="token-trade-info">
                <div className="trade-price-info">
                    <div className="info-item">
                        <span className="info-label">Current Price:</span>
                        <span className="info-value">{formatPrice(tokenDetails.price)}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">SOL Balance:</span>
                        <span className="info-value">{portfolio ? formatPrice(portfolio.balanceSOL, true) : '-'}</span>
                    </div>

                    {tokenDetails.holding && (
                        <div className="info-item">
                            <span className="info-label">Token Balance:</span>
                            <span className="info-value">{tokenDetails.holding.amount.toFixed(3)} {tokenDetails.symbol}</span>
                        </div>
                    )}
                </div>

                <form className="trade-form" onSubmit={handleTradeSubmit}>
                    <div className="trade-type-selector">
                        <button
                            type="button"
                            className={`type-btn ${tradeType === 'buy' ? 'active' : ''}`}
                            onClick={() => handleTradeTypeChange('buy')}
                        >
                            Buy
                        </button>
                        <button
                            type="button"
                            className={`type-btn ${tradeType === 'sell' ? 'active' : ''}`}
                            onClick={() => handleTradeTypeChange('sell')}
                        >
                            Sell
                        </button>
                    </div>

                    <div className="form-group">
                        <label>
                            {tradeType === 'buy' ? 'Amount (SOL)' : `Amount (${tokenDetails.symbol})`}:
                        </label>
                        <div className="input-wrapper">
                            <input
                                type="number"
                                value={tradeType === 'buy' ? buyAmount : sellAmount}
                                onChange={(e) => handleAmountChange(e.target.value)}
                                placeholder={`Enter ${tradeType === 'buy' ? 'SOL' : tokenDetails.symbol} amount`}
                                min="0"
                                step={tradeType === 'buy' ? (1 / 1e9) : (1 / 1e6)}
                                required
                            />
                            <div className="input-controls">
                                <button
                                    type="button"
                                    className="input-control-btn"
                                    onClick={() => setMaxAmount(25)}
                                >
                                    25%
                                </button>
                                <button
                                    type="button"
                                    className="input-control-btn"
                                    onClick={() => setMaxAmount(50)}
                                >
                                    50%
                                </button>
                                <button
                                    type="button"
                                    className="input-control-btn"
                                    onClick={() => setMaxAmount(100)}
                                >
                                    MAX
                                </button>
                            </div>
                        </div>
                    </div>

                    {tradeAmount && !isNaN(parseFloat(tradeAmount)) && (
                        <div className="estimated-receive">
                            You will receive approximately:
                            <strong>
                                {" "}
                                {tradeType === 'buy'
                                    ? (parseFloat(tradeAmount) / Number(tokenDetails.price)).toFixed(2)
                                    : (parseFloat(tradeAmount) * Number(tokenDetails.price)).toFixed(6)
                                }{" "}
                                {tradeType === 'buy' ? tokenDetails.symbol : 'SOL'}
                            </strong>
                        </div>
                    )}

                    <button type="submit" className={`submit-btn ${tradeType}-btn`}>
                        {tradeType === 'buy' ? 'Buy' : 'Sell'} {tokenDetails.symbol}
                    </button>

                    {tradeStatus && (
                        <div className={`trade-status ${tradeStatus.success === undefined ? 'pending' : tradeStatus.success ? 'success' : 'error'}`}>
                            {tradeStatus.message}
                        </div>
                    )}
                </form>
            </div>

            {tokenDetails.analytics?.tradingSignal && (
                <div className="trade-recommendation">
                    <h4>Trading Recommendation</h4>
                    <div className={`recommendation-tag ${getRecommendationInfo(tokenDetails.analytics?.tradingSignal.action).class}`}>
                        {getRecommendationInfo(tokenDetails.analytics?.tradingSignal.action).emoji} {tokenDetails.analytics?.tradingSignal.action}
                        {tokenDetails.analytics?.tradingSignal.action === 'BUY' && tokenDetails.analytics?.tradingSignal.entryPoints && (
                            <div className="entry-points">
                                <span>Suggested entry points:</span>
                                {tokenDetails.analytics?.tradingSignal.entryPoints.map((point, idx) => (
                                    <span key={idx} className="entry-point">{formatPrice(point)}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
