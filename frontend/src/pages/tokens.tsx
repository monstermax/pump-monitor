// tokens.tsx

import React, { useEffect, useState } from 'react';
import humanTime from 'human-time';

import TokenDetailModal from '../components/token_modal';
import { endpoint } from '../config';
import { Token } from '../types/server.types';



const TokensPage: React.FC = () => {
    const [tokens, setTokens] = useState<Token[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedToken, setSelectedToken] = useState<Token | null>(null);
    const [sortCriteria, setSortCriteria] = useState<'marketCap' | 'createdAt'>('createdAt');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    const fetchTokens = () => {
        setLoading(true);

        const findOptions = {
            sortCriteria,
            sortOrder,
        };

        const querystring = new URLSearchParams(findOptions).toString();

        fetch(`${endpoint}/api/tokens?${querystring}`)
            .then((res) => res.json())
            .then((data: Token[]) => {
                setTokens(data);
                setLoading(false);

                if (selectedToken) {
                    const updatedToken = data.find((token) => token.address === selectedToken.address);
                    if (updatedToken) {
                        setSelectedToken(updatedToken);
                    }
                }
            })
            .catch((err) => {
                console.error('Erreur lors de la récupération des tokens', err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchTokens();
    }, [sortCriteria, sortOrder]);


    // Trie des tokens selon le critère et l'ordre sélectionnés
    //const sortedTokens = [...tokens].sort((a, b) => {
    //    let comparison = 0;
    //    if (sortCriteria === 'marketCap') {
    //        comparison = a.marketCap - b.marketCap;
    //    } else {
    //        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    //    }
    //    return sortOrder === 'asc' ? comparison : -comparison;
    //});

    //const displayedTokens = sortedTokens.slice(0, 100);
    const displayedTokens = tokens.slice(0, 100);

    return (
        <div>
            <div className="d-flex justify-content-between align-items-center mt-4">
                <h1>Liste des Tokens</h1>
                <div className="d-flex align-items-center">
                    <select
                        className="form-select me-2"
                        style={{ width: '200px' }}
                        value={sortCriteria}
                        onChange={(e) => setSortCriteria(e.target.value as 'marketCap' | 'createdAt')}
                    >
                        <option value="createdAt">Date de création</option>
                        <option value="marketCap">Market Cap</option>
                    </select>
                    <select
                        className="form-select me-2"
                        style={{ width: '150px' }}
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                    >
                        <option value="asc">Ascendant</option>
                        <option value="desc">Descendant</option>
                    </select>

                    <button className="btn btn-outline-secondary" onClick={fetchTokens}>
                        Refresh
                    </button>
                </div>
            </div>

            {loading ? (
                <div>Chargement...</div>
            ) : (
                <table className="table table-striped mt-3">
                    <thead>
                        <tr>
                            <th>Adresse</th>
                            <th>Nom</th>
                            <th className='text-end'>Date de création</th>
                            <th className='text-end'>Trades</th>
                            <th className='text-end'>MarketCap USD</th>
                            <th className='text-end'>Prix SOL</th>
                            <th className='text-end'>Dev %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedTokens.map((token) => {
                            const dev = token.holders.find(holder => holder.type === 'dev');
                            return (
                                <tr
                                    key={token.address}
                                    onClick={() => setSelectedToken(token)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <td>{token.address}</td>
                                    <td>{token.name}</td>
                                    <td className='text-end' title={new Date(token.createdAt).toLocaleString()}>{humanTime(new Date(token.createdAt))}</td>
                                    <td className='text-end'>{token.trades.length}</td>
                                    <td className='text-end'>{token.marketCapUSD?.toFixed(2)}</td>
                                    <td className='text-end'>{token.trades.at(-1)?.price}</td>
                                    <td className='text-end'>{dev?.percentage.toFixed(2) ?? 0} %</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            {selectedToken && (
                <TokenDetailModal token={selectedToken} fetchTokens={fetchTokens} onClose={() => setSelectedToken(null)} />
            )}
        </div>
    );
};


export default TokensPage;
