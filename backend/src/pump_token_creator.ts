// pump_token_creator.ts

import { Connection, Keypair, ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import base58 from "bs58";

import { appConfig } from "./env";
import { log, warn } from "./lib/utils/console";
import { sleep } from "./lib/utils/time.util";
import { sendPortalCreateAndBuyTransaction, sendPortalSellTransaction } from "./lib/pumpfun/portal_tx/pumpfun_portal_api";
import { TransactionResult } from "./lib/solana/solana_tx_sender";
import { fetchParsedTransactionWithRetries } from "./lib/pumpfun/pumpfun_tx_tools";
import { decodeTradeTransactionFromLogs } from "./lib/pumpfun/pumpfun_tx_decoder";
import { TradeTransactionResult } from "./lib/pumpfun/pumpfun_trading";
import * as tokensMetasDatabase from "./creator/tokens_metadata.database";
import { createAndBuyWithMultipleWallets } from "./lib/pumpfun/portal_tx/pumpfun_portal_api_jito";
import { pumpFunSell } from "./lib/pumpfun/manual_tx/pumpfun_sell";



async function main() {

    log(`Creator démarré`);


    // 0) Configuration

    const tokenMetas = tokensMetasDatabase.DOPE;
    const solAmount = 0.01;

    const slippage = 5;
    const portalPriorityFee = 0.0001;
    const useJito = false;

    const sells = [
        { delay: 20, percent: 30},
        { delay: 30, percent: 100},
    ];


    // 1) create and buy token

    const mintWallet = Keypair.generate(); // TODO: générer une adresse qui termine par "pump"

    const creatorWallet = Keypair.fromSecretKey(base58.decode(appConfig.solana.WalletPrivateKey));
    const connection = new Connection(appConfig.solana.rpc.chainstack);

    const createAndBuyResult: TransactionResult = useJito
        ? await createAndBuyWithMultipleWallets(creatorWallet, [], [], mintWallet, tokenMetas, solAmount, slippage, portalPriorityFee)
        : await sendPortalCreateAndBuyTransaction(connection, creatorWallet, mintWallet, tokenMetas, solAmount, slippage, portalPriorityFee);

    log('result:', createAndBuyResult)


    // 2) wait for transaction response

    if (! createAndBuyResult.success || ! createAndBuyResult.signature) {
        warn(`Echec de création de token. ${createAndBuyResult.error}`);
        return;
    }

    console.log(`Transaction envoyée`);


    const onRetry = (attempt: number, elapsed: number) => {
        log(`Tentative ${attempt} d'obtenir la transaction de mint+buy (${elapsed}ms écoulées)...`);
    };

    const parsedTransaction: ParsedTransactionWithMeta | null = await fetchParsedTransactionWithRetries(connection, createAndBuyResult.signature, onRetry);

    if (! parsedTransaction) {
        warn(`Transaction non trouvée`);
        return;
    }

    console.log(`Transaction réceptionnée`);

    const decodedInstruction: TradeTransactionResult | null = decodeTradeTransactionFromLogs(parsedTransaction);

    if (! decodedInstruction) {
        //throw new Error(`Intruction de vente non décodée => tx ${transactionResult.signature}`);
        warn(`Intruction de vente non décodée => tx ${createAndBuyResult.signature}`);
        return;
    }

    console.log('Transaction décodée:', decodedInstruction);


    // TODO: suivre l'evolution des trades et du prix. et sortir au moment opportun

    let remainingTokenAmount = decodedInstruction.tokenAmount;
    let tokenAmount = 0;


    // 3) sell
    let sellIdx = 0;
    for (const sell of sells) {
        sellIdx++;

        console.log();
        console.log(`Attente ${sell.delay} secondes avant la vente #${sellIdx}...`);
        await sleep(sell.delay * 1000);
        console.log(`Vente #${sellIdx} ...`);

        tokenAmount = remainingTokenAmount * sell.percent / 100;
        remainingTokenAmount -= tokenAmount;

        // TODO: implémenter vente via jito

        //const sellResult: TransactionResult = await sendPortalSellTransaction(connection, creatorWallet, decodedInstruction.mint, tokenAmount, slippage, portalPriorityFee)
        const signature = await pumpFunSell(connection, null, creatorWallet, { mint: new PublicKey(decodedInstruction.mint) }, tokenAmount, slippage);
        console.log(`Vente #${sellIdx} confirmée => https://solscan.io/tx/${signature}`);

        // TODO: recuperer et verifier l'etat de la transaction

        if (remainingTokenAmount <= 0) break;
    }

}


/* ######################################################### */


// Démarrer le programme
main().catch((err: any) => {
    console.error('Erreur fatale:', err);
    process.exit(1);
});



