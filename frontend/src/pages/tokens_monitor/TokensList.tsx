// TokensList.tsx

import React from "react";

import { formatMarketCap, formatPrice } from "../../utils";

import type { Token } from "../../types/server.types";
import humanTime from "human-time";


export const TokensList: React.FC<{
    tokens: Token[],
    selectedToken: string | null,
    handleTokenSelect: (tokenAddress: string) => void
}> = ({ tokens, selectedToken, handleTokenSelect }) => {


    // Fonction qui détermine la classe CSS en fonction de la tendance
    const getPriceColorClass = (token: Token) => {
        // Vérifier que nous avons un historique des prix
        if (token && token.trades && token.trades.length > 1) {
            // Récupérer la tendance des derniers prix
            const prices = token.trades.length;
            let trend = 0;

            if (prices >= 2) {
                trend += (token.trades[prices - 2].price < token.trades[prices - 1].price) ? 4 : -4;
            }
            if (prices >= 3) {
                trend += (token.trades[prices - 3].price < token.trades[prices - 2].price) ? 3 : -3;
            }
            if (prices >= 4) {
                trend += (token.trades[prices - 4].price < token.trades[prices - 3].price) ? 2 : -2;
            }
            if (prices >= 5) {
                trend += (token.trades[prices - 5].price < token.trades[prices - 4].price) ? 1 : -1;
            }

            if (trend !== 0) {
                // Vérifier si la tendance est positive ou négative
                if (trend > 0) return 'price-up';
                if (trend < 0) return 'price-down';
            }
        }

        // Par défaut, pas de classe supplémentaire
        return '';
    };


    return (
        <div className="tokens-list">
            <h2>Recent Token Mints</h2>
            <div className="list-headers">
                <span className="token-time">Time</span>
                <span className="token-symbol">Symbol</span>
                <span className="token-name">Name</span>
                <span className="token-price">Price</span>
                <span className="token-cap">Market Cap</span>
                <span className="token-trades">Trades</span>
                <span className="token-holders-count">Holders</span>
            </div>
            <div className="scrollable-list">
                {tokens.length > 0 ? (
                    tokens.map((token) => (
                        <div
                            key={token.address}
                            className={`token-item ${selectedToken === token.address ? 'selected' : ''}`}
                            onClick={() => handleTokenSelect(token.address)}
                        >
                            <span className="token-time">{humanTime(new Date(token.createdAt))}</span>
                            <span className="token-symbol">{token.symbol}</span>
                            <span className="token-name">{token.name}</span>
                            <span className={`token-price ${getPriceColorClass(token)}`}>
                                {formatPrice(token.price)}
                            </span>
                            <span className="token-cap">{formatMarketCap(token.marketCapUSD)}</span>
                            <span className="token-trades">{token.trades.length}</span>
                            <span className="token-holders-count">{token.holders.length}</span>
                        </div>
                    ))
                ) : (
                    <div className="empty-list">No tokens detected yet</div>
                )}
            </div>
        </div>
    );
};

