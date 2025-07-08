// token_modal.tsx

import React from 'react';
import { Pie, Line } from 'react-chartjs-2';
import { Chart, ArcElement, Tooltip, Legend, LineElement, PointElement, CategoryScale, LinearScale } from 'chart.js';

import { Token } from '../types/server.types';


Chart.register(ArcElement, Tooltip, Legend, LineElement, PointElement, CategoryScale, LinearScale);


interface TokenDetailModalProps {
    token: Token;
    onClose: () => void;
    fetchTokens: () => void;
}


const holderColors: Record<string, string> = {
    trader: '#36A2EB', // Rouge
    dev: '#FF6384',
    bondingCurve: '#FFCE56', // Jaune
    // Ajoutez d'autres types et couleurs si nécessaire
};


const TokenDetailModal: React.FC<TokenDetailModalProps> = ({ token, onClose, fetchTokens }) => {
    // Agréger les pourcentages par type et par holder
    const holderDistribution = token.holders.reduce((acc: Record<string, number>, holder) => {
        acc[`${holder.type}-${holder.address}`] = (acc[`${holder.type}-${holder.address}`] || 0) + holder.percentage;
        return acc;
    }, {});

    // Préparer les données pour le graphique circulaire (Pie)
    const pieData = {
        labels: Object.keys(holderDistribution),
        datasets: [
            {
                data: Object.values(holderDistribution), // Les pourcentages
                backgroundColor: Object.keys(holderDistribution).map(typeAndAddress => holderColors[typeAndAddress.split('-')[0]] || '#CCCCCC'), // Couleurs par type
                hoverBackgroundColor: Object.keys(holderDistribution).map(typeAndAddress => holderColors[typeAndAddress.split('-')[0]] || '#CCCCCC'), // Couleurs au survol
            },
        ],
    };

    // Préparer les données pour le graphique linéaire (Line) de l'évolution de la marketcap
    const sortedHistory = [...token.trades].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const lineData = {
        labels: sortedHistory.map(ph => new Date(ph.timestamp).toLocaleTimeString()),
        datasets: [
            {
                label: 'MarketCap',
                data: sortedHistory.map(ph => ph.marketCapUSD),
                fill: false,
                borderColor: '#36A2EB',
                tension: 0.1,
            },
        ],
    };

    return (
        <div
            className="modal show d-block"
            tabIndex={-1}
            role="dialog"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={onClose}  // Ferme la modale en cliquant en dehors
        >
            <div
                className="modal-dialog modal-lg modal-dialog-centered"
                role="document"
                onClick={(e) => e.stopPropagation()} // Empêche la fermeture quand on clique sur la modale elle-même
            >
                <div className="modal-content">
                    <div className="modal-header">
                        <h5 className="modal-title">{token.name} - Aperçu - <a href={`https://pump.fun/coin/${token.address}`} target='_blank'>{token.address}</a></h5>

                        <button className="btn btn-outline-secondary btn-sm ms-auto" onClick={fetchTokens}>
                            Refresh
                        </button>

                        <button type="button" className="btn-close ms-5" aria-label="Close" onClick={onClose}></button>
                    </div>
                    <div className="modal-body">
                        <div className="mb-3">
                            <div className='d-flex justify-content-between mx-2'>
                                <p><strong>Market Cap :</strong> ${token.marketCapUSD?.toFixed(2)} USD<br />({token.marketCapSOL?.toFixed(3)} SOL)</p>
                                <p><strong>Prix :</strong> {token.trades.at(-1)?.price}</p>
                                <p><strong>Nombre de holders :</strong> {token.holders.length}</p>
                                <p><strong>Nombre de trades :</strong> {token.trades.length}</p>

                            </div>
                        </div>
                        <div className="row">
                            <div className="col-md-6">
                                <h6>Répartition des Holders</h6>
                                <Pie data={pieData} />
                            </div>
                            <div className="col-md-6">
                                <h6>Évolution de la MarketCap</h6>
                                <Line data={lineData} />
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Fermer
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


export default TokenDetailModal;


