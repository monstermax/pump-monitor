// pumpfun_trading.ts

import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from 'bn.js';

import { DEFAULT_DECIMALS } from "./pumpfun_config";


export type TradeTransactionResult = {
    type: 'buy' | 'sell';
    tokenAmount: number;
    solAmount: number;
    mint: string;
    success: boolean;
};



/* ######################################################### */



export function calculateWithSlippageBuy(amount: bigint, basisPoints: bigint) {
    return amount + (amount * basisPoints) / 10000n;
};


export function calculateWithSlippageSell(amount: bigint, basisPoints: bigint) {
    return amount - (amount * basisPoints) / 10000n;
};


// Récupérer le prix directement dans la blockchain
export async function getOnChainTokenPrice(connection: Connection, bondingCurveAddress: PublicKey) {
    try {

        // 📌 Lire les informations du compte de la bonding curve sur la blockchain
        const accountInfo = await connection.getAccountInfo(bondingCurveAddress);
        if (!accountInfo || !accountInfo.data) {
            console.error(`❌ Impossible de récupérer les réserves On-Chain`);
            return null;
        }

        console.log('accountInfo:', accountInfo)

        // 📌 Extraire les réserves SOL et Token (structure Pump.fun)
        const data = accountInfo.data;
        const tokenReserves = new BN(data.slice(8, 16), 'le'); // Tokens devraient être grands
        const solReserves = new BN(data.slice(16, 24), 'le'); // SOL devrait être petit

        // 📌 Calculer le prix exact
        const price = (solReserves.toNumber() / LAMPORTS_PER_SOL) / (tokenReserves.toNumber() / 10 ** DEFAULT_DECIMALS);

        if (!isFinite(price) || price <= 0) {
            console.warn(`⚠️ Prix calculé invalide : ${price}`);
            return null;
        }

        return price;

    } catch (error) {
        console.error(`❌ Erreur lors de la récupération du prix On-Chain :`, error);
        return null;
    }
}
