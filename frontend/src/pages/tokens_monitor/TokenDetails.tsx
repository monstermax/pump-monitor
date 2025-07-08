// TokenDetails.tsx

import { useContext, useEffect, useState } from "react";
import humanTime from "human-time";

import { SocketContext } from "../../contexts/SocketContext";
import { formatDate, formatMarketCap, formatPrice } from "../../utils";
import { TabChart } from "./token_details/TabChart";
import { TabManualTrading } from "./token_details/TabManualTrading";
import { TabSocial } from "./token_details/TabSocial";
import { TabAnalysys } from "./token_details/TabAnalysys";
import { TabTrades } from "./token_details/TabTrades";
import { TabHolders } from "./token_details/TabHolders";

import type { Portfolio, TokenDetailData, TradeResult } from "../../types/server.types";



export type TokenDetailsProps = {
    portfolio: Portfolio | null,
    tokenDetails: TokenDetailData,
}


export const TokenDetails: React.FC<TokenDetailsProps> = ({ portfolio, tokenDetails }) => {
    const socket = useContext(SocketContext);

    // État pour suivre l'onglet actif
    const [activeTab, setActiveTab] = useState<'analysis' | 'trades' | 'holders' | 'social' | 'trade' | 'chart'>('analysis');

    // État pour le formulaire d'achat/vente
    const [tradeAmount, setTradeAmount] = useState<string>(portfolio?.settings.defaultBuyAmount.toFixed(3) ?? "");
    const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
    const [tradeStatus, setTradeStatus] = useState<{ message: string, success?: boolean } | null>(null);


    // Écouteur pour les résultats de trading
    useEffect(() => {
        if (!socket) return;

        const handleTradeResult = (result: TradeResult) => {
            if (result.success) {
                setTradeStatus({
                    message: result.message,
                    success: true
                });
                // Réinitialiser le montant après un trade réussi
                setTradeAmount('');

            } else {
                setTradeStatus({
                    message: result.error || result.message,
                    success: false
                });
            }
        };

        socket.on('trade_result', handleTradeResult);

        return () => {
            socket.off('trade_result', handleTradeResult);
        };
    }, [socket]);


    // Fonction pour gérer la soumission du formulaire d'achat/vente
    const handleTradeSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const amount = parseFloat(tradeAmount);
        if (isNaN(amount) || amount <= 0) {
            setTradeStatus({ message: 'Veuillez entrer un montant valide', success: false });
            return;
        }

        // Montrer l'état en attente
        setTradeStatus({ message: `Transaction en cours...`, success: undefined });

        // Envoyer la demande au serveur via Socket.IO
        if (socket) {
            if (tradeType === 'buy') {
                socket.emit('buy_token', tokenDetails.address, amount);

            } else {
                socket.emit('sell_token', tokenDetails.address, amount);
            }

        } else {
            setTradeStatus({
                message: "Erreur: Socket non connecté. Veuillez rafraîchir la page.",
                success: false
            });
        }
    };

    const bondingCurveAddress = tokenDetails.holders.find(holder => holder.type === 'bondingCurve')?.address;
    const devAddress = tokenDetails.holders.find(holder => holder.type === 'dev')?.address;

    return (
        <div className="token-details">
            <div className="token-header">
                <div className="token-identity">
                    {tokenDetails.image && (
                        <img src={tokenDetails.image} alt={tokenDetails.name} className="token-logo" />
                    )}
                    <div>
                        <h2>{tokenDetails.name} ({tokenDetails.symbol})</h2>

                        <div className="token-address">
                            Pump: <a href={`https://pump.fun/coin/${tokenDetails.address}`} target="_blank">{tokenDetails.address}</a>
                        </div>
                        <div className="token-address">
                            Solscan:
                            <a className="ms-2" href={`https://solscan.io/account/${tokenDetails.address}`} target="_blank">Token</a>

                            {bondingCurveAddress && (
                                <a className="ms-2" href={`https://solscan.io/account/${bondingCurveAddress}`} target="_blank">Curve</a>
                            )}

                            {devAddress && (
                                <a className="ms-2" href={`https://solscan.io/account/${devAddress}`} target="_blank">Dev</a>
                            )}
                        </div>
                    </div>
                </div>
                <div className="token-meta">
                    <div className="meta-item">
                        <span className="meta-label">Market Cap:</span>
                        <span className="meta-value">{formatMarketCap(tokenDetails.marketCapUSD)}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">Price:</span>
                        <span className="meta-value">{formatPrice(tokenDetails.price)}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">Created:</span>
                        <span className="meta-value" title={formatDate(tokenDetails.createdAt)}>{humanTime(new Date(tokenDetails.createdAt))}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">Last activity:</span>
                        <span className="meta-value" title={formatDate(tokenDetails.lastUpdated)}>{humanTime(new Date(tokenDetails.lastUpdated))}</span>
                    </div>
                </div>
            </div>


            {/* Système d'onglets avec gestionnaires de clic */}
            <div className="token-detail-tabs">
                <div
                    className={`detail-tab ${activeTab === 'analysis' ? 'active' : ''}`}
                    onClick={() => setActiveTab('analysis')}
                >
                    Analysis
                </div>
                <div
                    className={`detail-tab ${activeTab === 'chart' ? 'active' : ''}`}
                    onClick={() => setActiveTab('chart')}
                >
                    Chart
                </div>
                <div
                    className={`detail-tab ${activeTab === 'holders' ? 'active' : ''}`}
                    onClick={() => setActiveTab('holders')}
                >
                    Holders <sup>{tokenDetails.holders.length}</sup>
                </div>
                <div
                    className={`detail-tab ${activeTab === 'trades' ? 'active' : ''}`}
                    onClick={() => setActiveTab('trades')}
                >
                    Trades <sup>{tokenDetails.trades?.length}</sup>
                </div>
                <div
                    className={`detail-tab ${activeTab === 'trade' ? 'active' : ''}`}
                    onClick={() => setActiveTab('trade')}
                >
                    Buy / Sell
                </div>
                <div
                    className={`detail-tab ${activeTab === 'social' ? 'active' : ''}`}
                    onClick={() => setActiveTab('social')}
                >
                    Social
                </div>
            </div>


            {/* Contenu des onglets */}
            <div className="token-detail-content">
                {activeTab === 'analysis' && (
                    <TabAnalysys tokenDetails={tokenDetails} />
                )}

                {activeTab === 'trades' && (
                    <TabTrades tokenDetails={tokenDetails} portfolio={portfolio} />
                )}

                {activeTab === 'holders' && (
                    <TabHolders tokenDetails={tokenDetails} portfolio={portfolio} />
                )}

                {activeTab === 'social' && (
                    <TabSocial tokenDetails={tokenDetails} />
                )}

                {activeTab === 'trade' && (
                    <TabManualTrading
                        tokenDetails={tokenDetails}
                        tradeType={tradeType}
                        tradeAmount={tradeAmount}
                        tradeStatus={tradeStatus}
                        handleTradeSubmit={handleTradeSubmit}
                        setTradeType={setTradeType}
                        setTradeAmount={setTradeAmount}
                        portfolio={portfolio}
                    />
                )}

                {activeTab === 'chart' && (
                    <TabChart tokenDetails={tokenDetails} />
                )}
            </div>
        </div>
    );
};







