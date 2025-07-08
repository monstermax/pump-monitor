// TabHolders.tsx

import { formatAddress } from "../../../utils";

import type { Portfolio, TokenDetailData, TokenHolder } from "../../../types/server.types";



export const TabHolders: React.FC<{ tokenDetails: TokenDetailData, portfolio: Portfolio | null }> = ({ tokenDetails, portfolio }) => {
    const boundingCurveHolder: TokenHolder = {
        address: tokenDetails.boundingCurve.address,
        tokenBalance: tokenDetails.boundingCurve.tokenAmount,
        percentage: tokenDetails.boundingCurve.percentage,
        type: 'bondingCurve',
        tradesCount: tokenDetails.trades.length,
        firstBuy: tokenDetails.createdAt,
        lastUpdate: tokenDetails.lastUpdated,
        tokenBlanceMax: tokenDetails.totalSupply,
    }

    const sortedHolders = [ boundingCurveHolder, ...tokenDetails.holders ]
        .sort((a, b) => b.percentage - a.percentage)

    return (
        <div className="token-holders">
            <div className="holders-list">
                {sortedHolders && sortedHolders.length > 0 ? (
                    <table className="holders-table">
                        <thead>
                            <tr>
                                <th>Address</th>
                                <th>Type</th>
                                <th className="text-end">Balance</th>
                                <th className="text-end">Percentage</th>
                                <th className="text-end">Valeur SOL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedHolders.map((holder, index) => {
                                const holderType = portfolio?.walletAddress === holder.address ? 'me' : holder.type;

                                return (
                                    <tr key={index} className={`holder-item ${holderType}`}>
                                        <td>
                                            <a href={`https://solscan.io/account/${holder.address}`} style={{ color:'inherit', textDecoration: 'none' }} target="_blank">{formatAddress(holder.address)}</a>
                                        </td>
                                        <td>{holderType}</td>
                                        <td className="text-end">{holder.tokenBalance.toFixed(6)}</td>
                                        <td className="text-end">{holder.percentage.toFixed(2)}%</td>
                                        <td className="text-end">{(holder.tokenBalance * Number(tokenDetails.price)).toFixed(3)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ) : (
                    <div className="no-holders">No holders information available</div>
                )}
            </div>
        </div>
    );
};
