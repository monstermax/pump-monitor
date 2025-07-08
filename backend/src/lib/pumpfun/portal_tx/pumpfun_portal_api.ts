// pumpfun_portal_api.ts

import fetch from 'node-fetch';
import FormData from 'form-data';
import { VersionedTransaction, Connection, Keypair, PublicKey } from '@solana/web3.js';

import { createTokenMetadata, CreateTokenMetadata } from '../pumpfun_token_metadata';
import { sendVersionedTransaction } from '../../solana/solana_tx_sender';

/* ######################################################### */


/** Construit et envoie une transaction d'achat pump.fun via le portal-api */
export async function sendPortalBuyTransaction(connection: Connection, wallet: Keypair, tokenAddress: string, solAmount: number, slippage = 10, priorityFee = 0.0001) {

    // Construction de la transaction
    const tx: VersionedTransaction = await buildPortalBuyTransaction(wallet.publicKey, tokenAddress, solAmount, slippage, priorityFee);

    tx.sign([wallet]);

    // Envoi de la transaction
    const result = await sendVersionedTransaction(connection, tx);

    return result;
}


/** Construit et envoie une transaction de creation+achat pump.fun via le portal-api */
export async function sendPortalCreateAndBuyTransaction(connection: Connection, wallet: Keypair, mint: Keypair, tokenMetadata: CreateTokenMetadata, solAmount: number, slippage = 10, priorityFee = 0.0001) {

    // Construction de la transaction
    const tx: VersionedTransaction = await buildPortalCreateAndBuyTransaction(wallet.publicKey, mint.publicKey, tokenMetadata, solAmount, slippage, priorityFee);


    // IMPORTANT: Signer avec les deux keypairs
    tx.sign([wallet, mint]);

    // Envoi de la transaction
    const result = await sendVersionedTransaction(connection, tx);

    return result;
}


/** Construit et envoie une transaction de vente pump.fun via le portal-api */
export async function sendPortalSellTransaction(connection: Connection, wallet: Keypair, tokenAddress: string, tokenAmount: number, slippage = 10, priorityFee = 0.0001) {

    // Construction de la transaction
    const tx: VersionedTransaction = await buildPortalSellTransaction(wallet.publicKey, tokenAddress, tokenAmount, slippage, priorityFee);

    tx.sign([wallet]);

    // Envoi de la transaction
    const result = await sendVersionedTransaction(connection, tx);

    return result;
}


/** Construit une transaction d'achat pump.fun via le portal-api */
export async function buildPortalBuyTransaction(walletPubKey: PublicKey, tokenAddress: string, solAmount: number, slippage = 10, priorityFee = 0.0001): Promise<VersionedTransaction> {
    const tradeData = {
        "publicKey": walletPubKey,  // Your wallet public key
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
        //tx.sign([wallet]);

        return tx;

    } else {
        //console.log('TX FAILED', response.statusText); // log error
        throw new Error(response.statusText)
    }
}


/** Construit et envoie une transaction de vente pump.fun via le portal-api */
export async function buildPortalSellTransaction(walletPubKey: PublicKey, tokenAddress: string, tokenAmount: number, slippage = 10, priorityFee = 0.0001): Promise<VersionedTransaction> {
    const tradeData = {
        "publicKey": walletPubKey,  // Your wallet public key
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
        //tx.sign([wallet]);

        return tx;

    } else {
        //console.log('TX FAILED', response.statusText); // log error
        throw new Error(response.statusText)
    }
}


/** Construit et envoie une transaction de creation+achat pump.fun via le portal-api */
export async function buildPortalCreateAndBuyTransaction(
    creator: PublicKey,
    mint: PublicKey,
    tokenMetadata: CreateTokenMetadata,
    buyAmountSol: number = 0.1,
    slippagePercent: number = 5,
    priorityFeeSol: number = 0.0001
): Promise<VersionedTransaction> {
    //console.log(`🌐 Demande de transaction via l'API Pump Portal...`);


    // Construction du FormData des Metadata
    const metadataResponseJSON = await createTokenMetadata(tokenMetadata)


    // Construction de la transaction
    const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            "publicKey": creator.toBase58(),
            "action": "create",
            "tokenMetadata": {
                name: metadataResponseJSON.metadata.name,
                symbol: metadataResponseJSON.metadata.symbol,
                uri: metadataResponseJSON.metadataUri
            },
            "mint": mint.toBase58(),
            "denominatedInSol": "true",
            "amount": buyAmountSol,
            "slippage": slippagePercent,
            "priorityFee": priorityFeeSol,
            "pool": "pump",
        })
    });


    if (response.status !== 200) {
        const errorText = await response.text();
        throw new Error(`Erreur API Pump Portal (${response.status}): ${errorText}`);
    }


    console.log(`✅ Transaction obtenue avec succès de l'API`);
    const data = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));

    return tx;
}

