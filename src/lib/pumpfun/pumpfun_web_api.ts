

import { VersionedTransaction, Connection, Keypair } from '@solana/web3.js';
import { TransactionResult } from '../../services/Trading.service';

/* ######################################################### */

const skipPreflight = false;

/* ######################################################### */


export async function buildPortalBuyTransaction(wallet: Keypair, tokenAddress: string, solAmount: number, slippage=10, priorityFee=0.0001): Promise<VersionedTransaction> {
    const tradeData = {
        "publicKey": wallet.publicKey,  // Your wallet public key
        "action": "buy",                 // "buy" or "sell"
        "mint": tokenAddress,         // contract address of the token you want to trade
        "denominatedInSol": "true",     // "true" if amount is amount of SOL, "false" if amount is number of tokens
        "amount": solAmount,                  // amount of SOL or tokens
        "slippage": slippage,                  // percent slippage allowed
        "priorityFee": priorityFee,          // priority fee
        "pool": "pump",                   // exchange to trade on. "pump", "raydium" or "auto"
    };

    //console.log('tradeData:', tradeData)


    const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(tradeData)
    });

    if (response.status === 200) { // successfully generated transaction
        const data = await response.arrayBuffer();
        const tx = VersionedTransaction.deserialize(new Uint8Array(data));
        tx.sign([wallet]);

        return tx;

    } else {
        //console.log('TX FAILED', response.statusText); // log error
        throw new Error(response.statusText)
    }
}


export async function sendPortalBuyTransaction(connection: Connection, wallet: Keypair, tokenAddress: string, solAmount: number, slippage=10, priorityFee=0.0001) {

    // Construction de la transaction
    const tx: VersionedTransaction = await buildPortalBuyTransaction(wallet, tokenAddress, solAmount, slippage, priorityFee);

    // Envoi de la transaction
    const signature = await connection.sendTransaction(tx, {
        skipPreflight,
        maxRetries: 3, // Autoriser des retries au niveau de l'API
        preflightCommitment: 'confirmed',
    });

    //console.log("Transaction: https://solscan.io/tx/" + signature);

    const result: TransactionResult = {
        success: true,
        signature,
    };

    return result;
}



export async function buildPortalSellTransaction(wallet: Keypair, tokenAddress: string, tokenAmount: number, slippage=10, priorityFee=0.0001): Promise<VersionedTransaction> {
    const tradeData = {
        "publicKey": wallet.publicKey,  // Your wallet public key
        "action": "sell",                 // "buy" or "sell"
        "mint": tokenAddress,         // contract address of the token you want to trade
        "denominatedInSol": "false",     // "true" if amount is amount of SOL, "false" if amount is number of tokens
        "amount": tokenAmount,                  // amount of SOL or tokens
        "slippage": slippage,                  // percent slippage allowed
        "priorityFee": priorityFee,          // priority fee
        "pool": "pump",                   // exchange to trade on. "pump", "raydium" or "auto"
    };

    //console.log('tradeData:', tradeData)


    const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(tradeData)
    });

    if (response.status === 200) { // successfully generated transaction
        const data = await response.arrayBuffer();
        const tx = VersionedTransaction.deserialize(new Uint8Array(data));
        tx.sign([wallet]);

        return tx;

    } else {
        //console.log('TX FAILED', response.statusText); // log error
        throw new Error(response.statusText)
    }
}



export async function sendPortalSellTransaction(connection: Connection, wallet: Keypair, tokenAddress: string, tokenAmount: number, slippage=10, priorityFee=0.0001) {

    // Construction de la transaction
    const tx: VersionedTransaction = await buildPortalSellTransaction(wallet, tokenAddress, tokenAmount, slippage, priorityFee);

    // Envoi de la transaction
    const signature = await connection.sendTransaction(tx, {
        skipPreflight,
        maxRetries: 3, // Autoriser des retries au niveau de l'API
        preflightCommitment: 'confirmed',
    });

    //console.log("Transaction: https://solscan.io/tx/" + signature);

    const result: TransactionResult = {
        success: true,
        signature,
    };

    return result;
}




