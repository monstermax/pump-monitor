// SystemTab.tsx

import React, { useEffect, useState } from 'react';
import humanTime from 'human-time';
import type { ServerStats, Token } from '../../../types/server.types';
import '../../../assets/SystemTab.css';
import { MAX_TOKENS } from '../../../config';

export type SystemTabProps = {
    serverStats: ServerStats | null;
    tokens: Token[];
}

export const SystemTab: React.FC<SystemTabProps> = ({ serverStats, tokens }) => {
    const [memoryUsage, setMemoryUsage] = useState<{ usedMB: number, totalMB: number, percentage: number } | null>(null);


    // Calcul des pourcentages pour les barres de progression
    const tokensPercentage = serverStats && serverStats.tokensMax ? (serverStats.tokens / serverStats.tokensMax) * 100 : 0;
    const clientTokensPercentage = (tokens.length / MAX_TOKENS) * 100;

    const allTradesCount = tokens.map(token => token.trades.length).reduce((p,c) => p+c, 0);


    useEffect(() => {
        // Mettre à jour l'utilisation de la mémoire toutes les secondes
        const memoryInterval = setInterval(() => {
            const usage = getMemoryUsage();
            setMemoryUsage(usage);

        }, 1000);

        return () => {
            clearInterval(memoryInterval);
        };
    }, []);


    // Fonction pour formater le temps d'activité en jours, heures, minutes, secondes
    const formatUptime = (seconds: number): string => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

        return parts.join(' ');
    };


    return (
        <div className="system-container">
            <div className="system-header">
                <h2 className="system-title">System Status</h2>
            </div>

            <div className="system-stats-grid">
                <div className="system-stats-column">
                    <div className="stats-section-header">
                        Server Statistics
                        {serverStats && (
                            <div className='stat-info'>
                                Last update: {humanTime(new Date(serverStats.lastUpdate))}
                            </div>
                        )}
                    </div>

                    {!serverStats && (<>Loading...</>)}

                    {serverStats && (
                        <>
                            <div className="stat-item">
                                <div className="stat-label">Tokens</div>
                                <div className="stat-bar-container">
                                    <div className="stat-bar blue" style={{ width: `${tokensPercentage}%` }}></div>
                                </div>
                                <div className="stat-value">{serverStats?.tokens} / {serverStats?.tokensMax || 'Unlimited'}</div>
                            </div>

                            <div className="stat-item">
                                <div className="stat-label">CPU Usage</div>
                                <div className="stat-bar-container">
                                    <div
                                        className={`stat-bar ${serverStats?.cpuUsage > 80 ? 'critical' : serverStats?.cpuUsage > 60 ? 'warning' : 'green'}`}
                                        style={{ width: `${serverStats?.cpuUsage || 0}%` }}
                                    ></div>
                                </div>
                                <div className="stat-value">
                                    {serverStats?.cpuUsage?.toFixed(1) || 0}%
                                    <span className="load-text">(Load: {serverStats?.cpuLoad?.toFixed(2) || 0})</span>
                                </div>
                            </div>

                            <div className="stat-item">
                                <div className="stat-label">RAM Usage</div>
                                <div className="stat-bar-container">
                                    <div
                                        className={`stat-bar ${serverStats?.ramUsage > 80 ? 'critical' : serverStats?.ramUsage > 60 ? 'warning' : 'green'}`}
                                        style={{ width: `${serverStats?.ramUsage || 0}%` }}
                                    ></div>
                                </div>
                                <div className="stat-value">
                                    {serverStats?.ramUsage?.toFixed(1) || 0}%
                                </div>
                            </div>

                            <div className="stat-item">
                                <div className="stat-label">Process Uptime</div>
                                <div className="stat-value uptime">{serverStats ? formatUptime(serverStats.uptime) : '-'}</div>
                            </div>
                        </>
                    )}
                </div>

                <div className="system-stats-column">
                    <div className="stats-section-header">Client Statistics</div>

                    <div className="stat-item">
                        <div className="stat-label">Tokens List</div>
                        <div className="stat-bar-container">
                            <div className="stat-bar blue" style={{ width: `${clientTokensPercentage}%` }}></div>
                        </div>
                        <div className="stat-value">{tokens.length} / {MAX_TOKENS}</div>
                    </div>

                    <div className="stat-item total-trades">
                        <div className="stat-label">Total Token Trades</div>
                        <div className="stat-value large-number">{allTradesCount}</div>
                    </div>

                    {memoryUsage && (
                        <div className="stat-item">
                            <div className="stat-label">RAM Usage</div>
                            <div className="stat-bar-container">
                                <div
                                    className={`stat-bar ${memoryUsage.percentage > 80 ? 'critical' : memoryUsage.percentage > 60 ? 'warning' : 'green'}`}
                                    style={{ width: `${memoryUsage.percentage || 0}%` }}
                                ></div>
                            </div>
                            <div className="stat-value">
                                <div className='d-flex justify-content-between'>
                                    <span className='mx-2'>{memoryUsage.usedMB.toFixed(1) || 0} MB</span>
                                    <span className='mx-2'>{memoryUsage.percentage.toFixed(1) || 0}%</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};



function getMemoryUsage(): { usedMB: number, totalMB: number, percentage: number } | null {
    if (window.performance && 'memory' in window.performance && window.performance.memory) {
        const memory = window.performance.memory as {totalJSHeapSize: number, usedJSHeapSize: number, jsHeapSizeLimit: number};

        const usedMB = (memory.usedJSHeapSize / (1024 * 1024));
        const totalMB = (memory.totalJSHeapSize / (1024 * 1024));
        const percentage = (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100;

        return {
            usedMB,
            totalMB,
            percentage,
        };

    } else {
        console.warn("L'API memory n'est pas disponible dans ce navigateur.")
        return null;
    }
}

