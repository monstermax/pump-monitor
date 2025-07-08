// TradesList.tsx

import { useEffect, useState } from "react";
import { Token, Trade } from "../../types/server.types";
import { formatAddress, formatDate, formatPrice, getTradeTypeClass } from "../../utils";

type TradesListProps = {
    tokens: Token[],
    selectedToken: string | null,
    handleTokenSelect: (tokenAddress: string) => void,
    trades: Trade[]
}

export const TradesList: React.FC<TradesListProps> = ({ tokens, trades, selectedToken, handleTokenSelect }) => {

    return (
        <div className="trades-list">
            <h2>Recent Trades</h2>
            <div className="list-headers">
                <span className="trade-time">Time</span>
                <span className="trade-type">Type</span>
                <span className="trade-token">Token</span>
                <span className="trade-amount">SOL</span>
                <span className="trade-price">Price</span>
            </div>
            <div className="scrollable-list">
                {trades.length > 0 ? (
                    trades.map((trade, index) => {
                        const token = tokens.find(token => token.address === trade.tokenAddress);

                        return (
                            <div
                                key={`${trade.tokenAddress}-${trade.timestamp}-${index}`}
                                className={`trade-item ${getTradeTypeClass(trade.type)}`}
                                onClick={() => handleTokenSelect(trade.tokenAddress)}
                            >
                                <span className="trade-time">{formatDate(trade.timestamp)}</span>
                                <span className="trade-type">{trade.type.toUpperCase()}</span>
                                <span className="trade-token">{token?.symbol || formatAddress(trade.tokenAddress)}</span>
                                <span className="trade-amount">{trade.solAmount ? trade.solAmount.toFixed(3) : '0.000'}</span>
                                <span className="trade-price">{formatPrice(trade.price)}</span>
                            </div>
                        );
                    })
                ) : (
                    <div className="empty-list">No trades detected yet</div>
                )}
            </div>
        </div>
    );
};

