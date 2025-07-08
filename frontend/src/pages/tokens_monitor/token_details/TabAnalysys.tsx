// TabAnalysys.tsx

import { useEffect, useState } from "react";

import { formatPrice, formatTime, formatWindowType, getRecommendationInfo, getScoreClass } from "../../../utils";

import type { RiskFlag, SafetyIndicator, Severity, TokenDetailData } from "../../../types/server.types";


export const TabAnalysys: React.FC<{ tokenDetails: TokenDetailData }> = ({ tokenDetails }) => {
    const [safetyData, setSafetyData] = useState(tokenDetails.analytics?.safety);
    const [riskData, setRiskData] = useState(tokenDetails.analytics?.risk);

    useEffect(() => {
        // Utiliser JSON.stringify pour une comparaison profonde
        const safetyString = JSON.stringify(tokenDetails.analytics?.safety);
        const riskString = JSON.stringify(tokenDetails.analytics?.risk);

        // Si les données ont changé, mettre à jour l'état local
        if (safetyString !== JSON.stringify(safetyData)) {
            setSafetyData(tokenDetails.analytics?.safety);
        }

        if (riskString !== JSON.stringify(riskData)) {
            setRiskData(tokenDetails.analytics?.risk);
        }
    }, [tokenDetails.analytics]);

    return (
        <div className="token-analysis">

            {/* Trends Analysis */}
            {tokenDetails.analytics?.trends && Object.keys(tokenDetails.analytics?.trends).length > 0 && (
                <div className="analysis-section">
                    <h3>Market Trends</h3>

                    <div className="trends-grid">
                        {Object.entries(tokenDetails.analytics?.trends).map(([windowType, trend]) => (
                            <div key={windowType} className="trend-card">
                                <h4>{formatWindowType(windowType)}</h4>
                                <div className="trend-info">
                                    <div className="trend-item">
                                        <span className="label">Market Cap Change:</span>
                                        <span className={`value ${trend.marketCap.change > 0 ? 'positive' : 'negative'}`}>
                                            {trend.marketCap.change > 0 ? '+' : ''}{trend.marketCap.change?.toFixed(2)}%
                                        </span>
                                    </div>
                                    <div className="trend-item">
                                        <span className="label">Buy/Sell Ratio:</span>
                                        <span className="value">
                                            {trend.trades.buyCount}/{trend.trades.sellCount}
                                        </span>
                                    </div>
                                    <div className="trend-item">
                                        <span className="label">Holders:</span>
                                        <span className="value">
                                            {trend.kpis.holdersMin} &lt; {trend.kpis.holdersMax}
                                        </span>
                                    </div>
                                    <div className="trend-item">
                                        <span className="label">Dev:</span>
                                        <span className="value">
                                            {trend.kpis.devBalanceMin ? trend.kpis.devBalanceMin.toFixed(0) : 0} &lt; {trend.kpis.devBalanceMax ? trend.kpis.devBalanceMax.toFixed(0) : 0}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}


            {/* Trading Recommendation */}
            {tokenDetails.analytics?.tradingSignal && (
                <div className="analysis-section recommendation-section">
                    <h3>Trading Recommendation</h3>

                    <div className={`recommendation ${getRecommendationInfo(tokenDetails.analytics?.tradingSignal.action).class}`}>
                        <div className="recommendation-action">
                            {getRecommendationInfo(tokenDetails.analytics?.tradingSignal.action).emoji} {tokenDetails.analytics?.tradingSignal.action}
                            <span className="confidence">({tokenDetails.analytics?.tradingSignal.confidence}% confidence)</span>
                        </div>

                        <div className="recommendation-reasons">
                            {tokenDetails.analytics?.tradingSignal.reasons.map((reason, index) => (
                                <div key={index} className="reason">• {reason}</div>
                            ))}
                        </div>

                        {tokenDetails.analytics?.tradingSignal.stopLoss && (
                            <div className="stop-loss">
                                <span className="label">Suggested Stop Loss:</span>
                                <span className="value">{formatPrice(tokenDetails.analytics?.tradingSignal.stopLoss)}</span>
                            </div>
                        )}

                        {tokenDetails.analytics?.tradingSignal.entryPoints && tokenDetails.analytics?.tradingSignal.entryPoints.length > 0 && (
                            <div className="entry-points">
                                <span className="label">Suggested Entry Points:</span>
                                <div className="entry-list">
                                    {tokenDetails.analytics?.tradingSignal.entryPoints.map((point, index) => (
                                        <span key={index} className="entry-point">{formatPrice(point)}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}


            {/* Safety & Risk Analysis */}
            <div className="analysis-grid">

                {/* Safety Score */}
                <div className="analysis-card">
                    <h3>Safety Analysis</h3>

                    {safetyData ? (
                        <>
                            <div className={`score ${getScoreClass(safetyData.score)}`}>
                                {safetyData.score}/100
                            </div>
                            <div className="indicators">
                                {sortIndicators(safetyData.indicators).map(indicator => (
                                    <div key={indicator.type} className={`indicator ${indicator.strength.toLowerCase()}-strength`}>
                                        {indicator.strength === 'HIGH' ? '🟢' : indicator.strength === 'MEDIUM' ? '🟡' : '🔴'}
                                        &nbsp;
                                        {false && <>{formatTime(indicator.detectedAt)}&nbsp;-&nbsp;</>}
                                        {indicator.description}
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="no-data">No safety analysis available</div>
                    )}
                </div>


                {/* Risk Score */}
                <div className="analysis-card">
                    <h3>Risk Analysis</h3>

                    {riskData ? (
                        <>
                            <div className={`score ${getScoreClass(riskData.score, true)}`}>
                                {riskData.score}/100
                            </div>
                            <div className="indicators">
                                {sortRedFlags(riskData.redFlags).map(flag => (
                                    <div key={flag.type} className={`indicator ${flag.severity.toLowerCase()}-severity`}>
                                        {flag.severity === 'HIGH' ? '🔴' : flag.severity === 'MEDIUM' ? '🟡' : '🟢'}
                                        &nbsp;
                                        {false && <>{formatTime(flag.detectedAt)}&nbsp;-&nbsp;</>}
                                        {flag.description}
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="no-data">No risk analysis available</div>
                    )}
                </div>
            </div>


            {/* Milestones */}
            <div className="analysis-section">
                <h3>Milestones</h3>

                <div className="milestones">
                    {tokenDetails.analytics?.growth?.milestones && tokenDetails.analytics.growth?.milestones.length > 0 ? (
                        tokenDetails.analytics.growth?.milestones.map((milestone, index) => (
                            <div key={index} className="milestone">
                                <div className={`milestone-value ${tokenDetails.marketCapUSD >= milestone.marketCapUSD ? "positive" : "negative"}`}>${milestone.marketCapUSD.toFixed(2)}</div>
                                <div className="milestone-time ">
                                    {(milestone.timeToReach / 60).toFixed(1)} min
                                    {index > 0 && tokenDetails.analytics?.growth?.milestones[index - 1] && (
                                        <span className="milestone-delta">
                                            {((milestone.timeToReach - tokenDetails.analytics.growth?.milestones[index - 1].timeToReach) / 60).toFixed(1)} min
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="no-milestones">No milestones reached yet</div>
                    )}
                </div>
            </div>

        </div>
    );
};





function sortIndicators(indicators: SafetyIndicator[]): SafetyIndicator[] {
    return [...indicators].sort((a,b) => strengthToNumber(a.strength) - strengthToNumber(b.strength));
}


function sortRedFlags(flags: RiskFlag[]): RiskFlag[] {
    return [...flags].sort((a,b) => strengthToNumber(a.severity) - strengthToNumber(b.severity));
}



function strengthToNumber(severity: Severity): number {
    if (severity === 'HIGH') return 1;
    if (severity === 'MEDIUM') return 2;
    if (severity === 'LOW') return 3;

    return 10;
}

