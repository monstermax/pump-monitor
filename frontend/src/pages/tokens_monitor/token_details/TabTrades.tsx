// TabTrades.tsx

import { formatAddress, formatDate, formatPrice, getTradeTypeClass } from "../../../utils";

import type { Portfolio, TokenDetailData } from "../../../types/server.types";


type TabTradesProps = {
    tokenDetails: TokenDetailData,
    portfolio: Portfolio | null,
};


export const TabTrades: React.FC<TabTradesProps> = ({ tokenDetails, portfolio }) => {
    return (
        <div className="token-trades-tab">
            <div className="trades-list-container">
                <div className="trades-header">
                    <span className="trades-col trades-time">Time</span>
                    <span className="trades-col trades-type">Type</span>
                    <span className="trades-col trades-trader">Trader</span>
                    <span className="trades-col trades-volume">{tokenDetails.symbol}</span>
                    <span className="trades-col trades-amount">SOL</span>
                    <span className="trades-col trades-price">Price</span>
                </div>
                <div className="trades-scrollable">
                    {tokenDetails.trades && tokenDetails.trades.length > 0 ? (
                        [...tokenDetails.trades].reverse().map((trade, index) => {
                            const holderType = portfolio?.walletAddress === trade.traderAddress ? 'me' : 'trader';

                            return (
                                <div key={index} className={`trades-row ${getTradeTypeClass(trade.type)}`}>
                                    <span className="trades-col trades-time">{formatDate(trade.timestamp)}</span>
                                    <span className="trades-col trades-type">{trade.type.toUpperCase()}</span>
                                    <span className={`trades-col trades-trader ${holderType}`}>
                                        <a href={`https://solscan.io/account/${trade.traderAddress}`} style={{ color:'inherit', textDecoration: 'none' }} target="_blank">
                                        {formatAddress(trade.traderAddress)}
                                        <span style={{ color: '#fff' }}>{tokenDetails.creator === trade.traderAddress && <>&nbsp;⚠️ DEV</>}</span>
                                        </a>
                                    </span>
                                    <span className="trades-col trades-volume">{trade.tokenAmount ? trade.tokenAmount.toFixed(6) : '0.000000'}</span>
                                    <span className="trades-col trades-amount">{trade.solAmount ? trade.solAmount.toFixed(3) : '0.000'}</span>
                                    <span className="trades-col trades-price">{formatPrice(trade.price)}</span>
                                </div>
                            );
                        })
                    ) : (
                        <div className="no-trades">No recent trades</div>
                    )}
                </div>
            </div>
        </div>
    );
};

