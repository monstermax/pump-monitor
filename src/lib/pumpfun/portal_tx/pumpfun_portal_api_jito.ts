// pumpfun_portal_api_jito.ts

import fetch from 'node-fetch';
import FormData from 'form-data';
import bs58 from 'bs58';
import { VersionedTransaction, Keypair } from '@solana/web3.js';

import { TransactionResult } from '../../solana/solana_tx_sender';
import { CreateTokenMetadata } from '../pumpfun_token_metadata';

/* ######################################################### */

export type transactionRequest = {
    walletIndex: number;
    action: 'buy' | 'sell' | 'create',
    mint: string;
    denominatedInSol: boolean;
    amount: number;
    slippage?: number;
    pool?: 'pump' | 'raydium' | 'auto'
}


export type BundledTxArg = {
    publicKey: string;
    action: 'buy' | 'sell' | 'create',
    tokenMetadata?: {
        name: any;
        symbol: any;
        uri: any;
    };
    mint: string;
    denominatedInSol: string;
    amount: number;
    slippage: number;
    priorityFee: number;
    pool: string;
}

/* ######################################################### */



/** Construit et envoie un bundle de transactions via Jito */
export async function sendPortalBundleTransaction(
    transactionRequests: transactionRequest[],
    wallets: Keypair[],
    priorityFee: number = 0.00005
): Promise<TransactionResult> {
    if (transactionRequests.length === 0 || transactionRequests.length > 5) {
        throw new Error("Le nombre de transactions doit être entre 1 et 5");
    }

    if (wallets.length < Math.max(...transactionRequests.map(tr => tr.walletIndex)) + 1) {
        throw new Error("Nombre insuffisant de portefeuilles fournis");
    }

    try {
        // Préparer les arguments pour chaque transaction
        const bundledTxArgs: BundledTxArg[] = transactionRequests.map((req, index) => ({
            publicKey: wallets[req.walletIndex].publicKey.toBase58(),
            action: req.action,
            mint: req.mint,
            denominatedInSol: req.denominatedInSol ? "true" : "false",
            amount: req.amount,
            slippage: req.slippage || 10,
            priorityFee: index === 0 ? priorityFee : 0, // Seule la première transaction a des frais de priorité
            pool: req.pool || "pump"
        }));


        // Appeler l'API pour générer les transactions
        const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(bundledTxArgs)
        });

        if (response.status !== 200) {
            throw new Error(`Erreur API (${response.status}): ${response.statusText}`);
        }


        // Décoder et signer chaque transaction
        const transactions = await response.json();
        let encodedSignedTransactions: string[] = [];
        let signatures: string[] = [];

        for (let i = 0; i < bundledTxArgs.length; i++) {
            const tx = VersionedTransaction.deserialize(
                new Uint8Array(bs58.decode(transactions[i]))
            );

            // Signer avec le portefeuille correspondant
            tx.sign([wallets[transactionRequests[i].walletIndex]]);

            encodedSignedTransactions.push(bs58.encode(tx.serialize()));
            signatures.push(bs58.encode(tx.signatures[0]));
        }


        // Envoyer le bundle à Jito
        const jitoResponse = await fetch(`https://mainnet.block-engine.jito.wtf/api/v1/bundles`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendBundle",
                "params": [
                    encodedSignedTransactions
                ]
            })
        });

        const jitoResult = await jitoResponse.json();


        if (jitoResult.error) {
            return {
                success: false,
                error: new Error(`Erreur Jito: ${JSON.stringify(jitoResult.error)}`),
                signature: signatures[0]
            };
        }

        return {
            success: true,
            signature: signatures[0],
            results: jitoResult.result
        };

    } catch (error: any) {
        return {
            success: false,
            error
        };
    }
}


// Version simplifiée pour un cas fréquent: acheter le même token avec plusieurs wallets
export async function sendPortalMultiBuyTransaction(
    tokenAddress: string,
    wallets: Keypair[],
    solAmounts: number[],
    slippage: number = 10,
    priorityFee: number = 0.00005
): Promise<TransactionResult> {
    if (wallets.length !== solAmounts.length || wallets.length === 0 || wallets.length > 5) {
        throw new Error("Le nombre de wallets doit correspondre au nombre de montants et être entre 1 et 5");
    }

    const transactionRequests: transactionRequest[] = wallets.map((_, index) => ({
        walletIndex: index,
        action: 'buy' as const,
        mint: tokenAddress,
        denominatedInSol: true,
        amount: solAmounts[index],
        slippage
    }));

    const transactionResult: TransactionResult = await sendPortalBundleTransaction(
        transactionRequests,
        wallets,
        priorityFee
    );

    return transactionResult;
}



/** Crée un nouveau token et l'achète immédiatement avec plusieurs wallets */
export async function createAndBuyWithMultipleWallets(
    creatorWallet: Keypair,
    buyerWallets: Keypair[],
    buyAmounts: number[],
    mintKeypair: Keypair,
    tokenMetadata: CreateTokenMetadata,
    creatorSolAmount: number,
    slippage: number = 10,
    priorityFee: number = 0.00005
): Promise<TransactionResult> {
    if (buyerWallets.length !== buyAmounts.length || buyAmounts.length > 4) {
        throw new Error("Le nombre de wallets doit correspondre au nombre de montants et le total ne peut pas dépasser 5 transactions");
    }

    try {
        // 1. Préparer les métadonnées et obtenir l'URI
        const tokenMetadataFormData = new FormData();

        //const file: Blob = await tokenMetadata.file();
        //tokenMetadataFormData.append("file", file);

        const arrayBuffer = await (await tokenMetadata.file()).arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        tokenMetadataFormData.append("file", buffer, {
            filename: 'image.png',
            contentType: 'image/png' // Ajustez selon le type de fichier
        });

        tokenMetadataFormData.append("name", tokenMetadata.name);
        tokenMetadataFormData.append("symbol", tokenMetadata.symbol);
        tokenMetadataFormData.append("description", tokenMetadata.description);

        if (tokenMetadata.twitter) {
            tokenMetadataFormData.append("twitter", tokenMetadata.twitter);
        }

        if (tokenMetadata.telegram) {
            tokenMetadataFormData.append("telegram", tokenMetadata.telegram);
        }

        if (tokenMetadata.website) {
            tokenMetadataFormData.append("website", tokenMetadata.website);
        }

        if (tokenMetadata.showName) {
            tokenMetadataFormData.append("showName", tokenMetadata.showName ? 'true' : 'false');
        }

        // Créer le stockage IPFS pour les métadonnées
        const metadataResponse = await fetch("https://pump.fun/api/ipfs", {
            method: "POST",
            body: tokenMetadataFormData,
        });

        const metadataResponseJSON = await metadataResponse.json();


        // 2. Préparer toutes les transactions du bundle

        // Première transaction: création du token
        const bundledTxArgs: BundledTxArg[] = [
            {
                publicKey: creatorWallet.publicKey.toBase58(),
                action: "create",
                tokenMetadata: {
                    name: metadataResponseJSON.metadata.name,
                    symbol: metadataResponseJSON.metadata.symbol,
                    uri: metadataResponseJSON.metadataUri
                },
                mint: mintKeypair.publicKey.toBase58(),
                denominatedInSol: "true",
                amount: creatorSolAmount,
                slippage: slippage,
                priorityFee: priorityFee, // Frais de priorité pour la première tx
                pool: "pump",
            }
        ];

        // Ajouter les transactions d'achat pour les autres wallets
        for (let i = 0; i < buyerWallets.length; i++) {
            bundledTxArgs.push({
                publicKey: buyerWallets[i].publicKey.toBase58(),
                action: "buy",
                mint: mintKeypair.publicKey.toBase58(),
                denominatedInSol: "true",
                amount: buyAmounts[i],
                slippage: slippage,
                priorityFee: 0, // Seule la première tx a des frais de priorité
                pool: "pump",
            });
        }


        // 3. Obtenir les transactions via l'API
        const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(bundledTxArgs)
        });

        if (response.status !== 200) {
            throw new Error(`Erreur API (${response.status}): ${response.statusText}`);
        }


        // 4. Décoder et signer chaque transaction
        const transactions = await response.json();
        let encodedSignedTransactions: string[] = [];
        let signatures: string[] = [];

        // Pour la première transaction (création), signer avec creatorWallet ET mintKeypair
        const createTx = VersionedTransaction.deserialize(
            new Uint8Array(bs58.decode(transactions[0]))
        );
        createTx.sign([creatorWallet, mintKeypair]);
        encodedSignedTransactions.push(bs58.encode(createTx.serialize()));
        signatures.push(bs58.encode(createTx.signatures[0]));

        // Pour les transactions d'achat, signer avec le wallet correspondant
        for (let i = 1; i < bundledTxArgs.length; i++) {
            const tx = VersionedTransaction.deserialize(
                new Uint8Array(bs58.decode(transactions[i]))
            );
            tx.sign([buyerWallets[i - 1]]);
            encodedSignedTransactions.push(bs58.encode(tx.serialize()));
            signatures.push(bs58.encode(tx.signatures[0]));
        }


        // 5. Envoyer le bundle à Jito
        const jitoResponse = await fetch(`https://mainnet.block-engine.jito.wtf/api/v1/bundles`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendBundle",
                "params": [
                    encodedSignedTransactions
                ]
            })
        });

        const jitoResult = await jitoResponse.json();

        if (jitoResult.error) {
            return {
                success: false,
                error: new Error(`Erreur Jito: ${JSON.stringify(jitoResult.error)}`),
                signature: signatures[0],
            };
        }

        return {
            success: true,
            signature: signatures[0],
            results: jitoResult.result
        };

    } catch (error: any) {
        return {
            success: false,
            error
        };
    }
}


/*


// EXEMPLES //


// Exemple d'utilisation pour acheter un token avec plusieurs wallets
const result = await sendPortalMultiBuyTransaction(
    connection,
    "BEnqoCfjYnRractBv5Vh3Rz39aQFyusguKXLF5jdpump", // adresse du token
    [wallet1, wallet2, wallet3], // liste des wallets
    [0.01, 0.02, 0.03], // montants SOL pour chaque wallet
    10, // slippage
    0.00005 // priority fee
);

if (result.success) {
    console.log("Bundle envoyé avec succès!");
    result.signatures?.forEach((sig, i) => {
        console.log(`Transaction ${i}: https://solscan.io/tx/${sig}`);
    });
} else {
    console.error("Erreur lors de l'envoi du bundle:", result.error);
}



// Création et achat avec plusieurs wallets
const result = await createAndBuyWithMultipleWallets(
    connection,
    creatorWallet,          // Wallet créateur
    [wallet1, wallet2, wallet3], // Wallets acheteurs
    [0.1, 0.2, 0.3],        // Montants d'achat en SOL
    {                       // Métadonnées du token
        name: "My New Token",
        symbol: "MNT",
        description: "This is my new token on Pump.fun",
        file: () => new Blob([...]),
        website: "https://example.com",
        twitter: "@example",
        showName: true
    },
    mintKeypair,            // Keypair pour le nouveau token
    10,                     // Slippage (%)
    0.00005                 // Priority fee
);


*/