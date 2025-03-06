// pumpfun_tx.ts

import { ParsedTransactionWithMeta } from "@solana/web3.js";

/* ######################################################### */


/** Décode les informations d'une transaction liée à Pump.fun */
export function decodeTransaction(tx: ParsedTransactionWithMeta | null): {
    type: 'buy' | 'sell';
    token_amount: number;
    sol_amount: number;
    mint: string;
    success: boolean;
} | null {
    if (!tx || !tx.meta) return null;

    try {
        // Vérifier si la transaction a réussi
        const success = tx.meta.err === null;

        // Chercher dans les logs pour déterminer le type et les détails
        let type: 'buy' | 'sell' | null = null;
        let mint: string | null = null;

        // Parcourir les logs pour trouver des indices
        const logs = tx.meta.logMessages || [];
        for (const log of logs) {
            if (log.includes('Instruction: Buy')) {
                type = 'buy';
            } else if (log.includes('Instruction: Sell')) {
                type = 'sell';
            }

            // Chercher des références au mint dans les logs
            const mintMatch = log.match(/mint: ([0-9a-zA-Z]{32,44})/);
            if (mintMatch && mintMatch[1]) {
                mint = mintMatch[1];
            }
        }

        // Si on n'a pas pu déterminer le type ou le mint, essayer d'autres méthodes
        if (!type || !mint) {
            // Parcourir les instructions pour trouver des informations
            if (tx.transaction && tx.transaction.message) {
                const message = tx.transaction.message;

                // Chercher les comptes qui pourraient être des mints
                const accounts = message.accountKeys;
                for (const account of accounts) {
                    // Les mints Pump.fun se terminent souvent par "pump"
                    if (account.pubkey && account.pubkey.toString().endsWith('pump')) {
                        mint = account.pubkey.toString();
                        break;
                    }
                }
            }
        }

        // Si on n'a toujours pas les informations nécessaires, analyser les changements de balances
        let tokenAmount = 0;
        let solAmount = 0;

        if (tx.meta.postTokenBalances && tx.meta.preTokenBalances) {
            // Calculer les changements de balances de tokens
            const preBalances = new Map();
            tx.meta.preTokenBalances.forEach(balance => {
                preBalances.set(`${balance.owner}-${balance.mint}`, balance.uiTokenAmount.uiAmount || 0);
            });

            tx.meta.postTokenBalances.forEach(balance => {
                const key = `${balance.owner}-${balance.mint}`;
                const pre = preBalances.get(key) || 0;
                const post = balance.uiTokenAmount.uiAmount || 0;
                const diff = post - pre;

                if (Math.abs(diff) > 0) {
                    tokenAmount = Math.abs(diff);
                    mint = balance.mint;
                    type = diff > 0 ? 'buy' : 'sell';
                }
            });
        }

        // Calculer le changement de SOL
        if (tx.meta.preBalances && tx.meta.postBalances) {
            for (let i = 0; i < tx.meta.preBalances.length; i++) {
                const pre = tx.meta.preBalances[i];
                const post = tx.meta.postBalances[i];
                const diff = (post - pre) / 1e9; // Convertir lamports en SOL

                if (Math.abs(diff) > 0.001) { // Ignorer les petits changements (frais)
                    solAmount = Math.abs(diff);
                    // Si on n'a pas encore déterminé le type, le faire en fonction du changement de SOL
                    if (!type) {
                        type = diff < 0 ? 'buy' : 'sell';
                    }
                }
            }
        }

        // Si on n'a pas pu déterminer toutes les informations nécessaires
        if (!type || !mint) {
            console.warn("Impossible de décoder complètement la transaction");
            return null;
        }

        return {
            type,
            token_amount: tokenAmount,
            sol_amount: solAmount,
            mint,
            success
        };

    } catch (error) {
        console.error("Erreur lors du décodage de la transaction:", error);
        return null;
    }
}



