// traders.tsx

import React, { useEffect, useState } from 'react';

import { endpoint } from '../config';


interface Trader {
    _id: string;
    address: string;
    performance: {
        totalProfit: number;
        successRate: number;
        avgHoldTime: number;
    };
    trades: Array<{
        timestamp: string;
        tokenAddress: string;
        type: string;
        solAmount: number;
        tokenAmount: number;
    }>;
}


const TradersPage: React.FC = () => {
    const [traders, setTraders] = useState<Trader[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchTraders = () => {

        const findOptions = {
            //sortCriteria,
            //sortOrder,
        };

        const querystring = new URLSearchParams(findOptions).toString();

        fetch(`${endpoint}/api/traders?${querystring}`)
            .then((res) => res.json())
            .then((data: Trader[]) => {
                setTraders(data);
                setLoading(false);
            })
            .catch((err) => {
                console.error('Erreur lors de la récupération des traders', err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchTraders();
    }, []);

    const displayedTraders = traders.slice(0, 100);

    return (
        <div>
            <div className="d-flex justify-content-between align-items-center mt-4">
                <h1>Liste des Traders</h1>

                <button className="btn btn-outline-secondary" onClick={fetchTraders}>
                    Refresh
                </button>
            </div>
            {loading ? (
                <div>Chargement...</div>
            ) : (
                <table className="table table-striped mt-3">
                    <thead>
                        <tr>
                            <th>Adresse</th>
                            <th>Total Profit</th>
                            <th>Success Rate</th>
                            <th>Avg Hold Time (sec)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedTraders.map((trader) => (
                            <tr key={trader._id}>
                                <td>{trader.address}</td>
                                <td>{trader.performance.totalProfit}</td>
                                <td>{trader.performance.successRate} %</td>
                                <td>{trader.performance.avgHoldTime}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};


export default TradersPage;
