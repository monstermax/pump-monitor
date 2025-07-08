// TabChart.tsx

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { TokenDetailData } from "../../../types/server.types";
import { formatPrice } from '../../../utils';


export const TabChart: React.FC<{ tokenDetails: TokenDetailData }> = ({ tokenDetails }) => {
    const volumeIn = tokenDetails.trades?.filter(trade => trade.type === 'buy').map(trade => trade.solAmount).reduce((p,c) => p+c, 0) ?? 0;
    const volumeOut = tokenDetails.trades?.filter(trade => trade.type === 'sell').map(trade => trade.solAmount).reduce((p,c) => p+c, 0) ?? 0;
    const balance = volumeIn - volumeOut;
    return (
        <div className="token-chart">
            <h3>Price Chart for {tokenDetails.symbol}</h3>

            {/* Si vous avez des données historiques de prix */}
            {tokenDetails.trades && tokenDetails.trades.length > 0 ? (
                <div className="chart-container">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                            data={tokenDetails.trades.map(entry => ({
                                time: new Date(entry.timestamp).getTime(),
                                price: entry.price
                            }))}
                            margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                            <XAxis
                                dataKey="time"
                                type="number"
                                domain={['dataMin', 'dataMax']}
                                scale="time"
                                tickFormatter={(time) => new Date(time).toLocaleTimeString()}
                                stroke="#666"
                                ticks={tokenDetails.trades.map(point => new Date(point.timestamp).getTime()).filter((time, index, self) => 
                                    self.indexOf(time) === index
                                  ).slice(0, 5)} // Limiter à 5 ticks maximum
                            />
                            <YAxis stroke="#666"  />
                            <Tooltip
                                formatter={(value) => [`${formatPrice(Number(value))}`, 'Price']}
                                labelFormatter={(time) => new Date(time).toLocaleString()}
                            />
                            <Line
                                type="monotone"
                                dataKey="price"
                                stroke="#3498db"
                                dot={false}
                                strokeWidth={2}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <div className="no-chart-data">
                    No historical price data available to display chart
                </div>
            )}

            {/* Affichage des statistiques importantes */}
            <div className="chart-stats">
                <div className="stat-item text-end">
                    <span className="stat-label">24h Change:</span>
                    <span className="stat-value change-positive">N/A</span>
                </div>
                <div className="stat-item">
                    <div className='text-end'>
                        <span className="stat-label">ATH:</span>
                        <span className="stat-value">{formatPrice(Math.max(...tokenDetails.trades.map(price => Number(price.price))))}</span>
                    </div>
                    <div className='text-end'>
                        <span className="stat-label">ATL:</span>
                        <span className="stat-value">{formatPrice(Math.min(...tokenDetails.trades.map(price => Number(price.price))))}</span>
                    </div>
                </div>
                <div className="stat-item">
                    <div className='text-end'>
                        <span className="stat-label">Volume In:</span>
                        <span className="stat-value">{volumeIn.toFixed(3)} SOL</span>
                    </div>
                    <div className='text-end'>
                        <span className="stat-label">Volume Out:</span>
                        <span className="stat-value">{volumeOut.toFixed(3)} SOL</span>
                    </div>
                </div>
                <div className="stat-item">
                    <div className='text-end'>
                        <span className="stat-label">Volume Total:</span>
                        <span className="stat-value">{tokenDetails.trades ? (tokenDetails.trades.map(trade => trade.solAmount).reduce((p,c) => p+c, 0).toFixed(3) + ' SOL') : '-'}</span>
                    </div>
                    <div className='text-end'>
                        <span className="stat-label">Balance:</span>
                        <span className="stat-value">{balance.toFixed(3)} SOL</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

