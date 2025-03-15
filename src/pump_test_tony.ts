
import { config } from 'dotenv';
config({ path: `${__dirname}/../../../.env` });

import { Connection, Keypair, LAMPORTS_PER_SOL, ParsedTransactionWithMeta, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import base58 from 'bs58';
import BN from 'bn.js';

import { DEFAULT_DECIMALS, FEE_RECIPIENT, PUMPFUN_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM, PUMPFUN_PROGRAM_ID } from "./lib/pumpfun/pumpfun_config";
import { appConfig } from './env';
import { PuppeteerWebSocketClient } from './monitor/listeners/pumpfun-websocket-frontend-client.puppeteer';
import { now } from './lib/utils/console';
import { CreateTokenTxResult } from './monitor/services/PumpListener.service';
import { PumpWebsocketApi } from './monitor/listeners/PumpWebsocketApi.listener';
import { ServiceManager } from './monitor/managers/Service.manager';
import { pumpFunBuy } from './lib/pumpfun/manual_tx/pumpfun_buy';
import { pumpFunSell } from './lib/pumpfun/manual_tx/pumpfun_sell';
import { sleep } from './lib/utils/time.util';
import { getTokenBalance } from './lib/solana/account';
import { asserts } from './lib/utils/asserts';
import { fetchParsedTransactionWithRetries } from './lib/pumpfun/pumpfun_tx_tools';


const rpcUrl = appConfig.solana.rpc.helius
const connection = new Connection(rpcUrl, 'processed');

const MIN_CREATOR_INVESTMENT = 0;
const MAX_ACTIVE_BUYS = 0;

const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

let associatedbondingCurve: string | null = null;
let transactionsLog: any = {};


async function listenForNewTokens() {
    console.log("Démarrage écoute WebSocket blockchain (nouvelles créations uniquement)...");

    const subscriptionId = connection.onLogs(
        new PublicKey(PUMPFUN_PROGRAM_ID),
        async (logs) => {
            const { signature, logs: logEntries } = logs;
            // Charger transactionsLog pour vérifier les achats actifs
            try {
                transactionsLog = ''; //JSON.parse(fs.readFileSync(transactionsFilePath, 'utf8'));
            } catch (error) {
                console.error('Erreur chargement transactionsLog:', error);
                return;
            }
            const pendingTx = Object.entries(transactionsLog).filter(([_, tx]) => (<any>tx).status === 'pending');
            const activeBuysNow = Object.entries(transactionsLog).filter(([_, tx]) => (<any>tx).type === 'buy').length;

            if (pendingTx.length > 0) {
                console.log(`⏳ ${pendingTx.length} transactions en attente. Recherche en pause.`);
                return;
            }

            //if (activeBuysNow >= MAX_ACTIVE_BUYS) {
            //    console.log(`⛔ Trop de tokens achetés (${activeBuysNow}/${MAX_ACTIVE_BUYS}). Arrêt de l’écoute réseau.`);
            //    await connection.removeProgramAccountChangeListener(subscriptionId);
            //    return;
            //}


            // Filtrer strictement les créations de tokens
            if (logEntries.includes('Program log: Instruction: Create')) {

                /*
                const dataLog = logs.logs.find(log => log.startsWith(`Program data: vdt/007`));

                if (dataLog) {
                    try {
                        const metadataExtracted = extractMetadataFromProgramData(dataLog);
                        console.log(metadataExtracted);

                    } catch (err: any) {
                        console.warn('Impossible d\'extraire les métadonnées:', err);
                    }
                }
                */

                console.log(now(), `TOKEN MINT TONY : ${'tokenMint'}`);

                const tx = await connection.getParsedTransaction(signature, {
                    maxSupportedTransactionVersion: 0,
                    commitment: 'confirmed',
                });

                if (!tx || !tx.transaction || !tx.transaction.message) {
                    //console.log(`[WebSocket Blockchain] Transaction invalide : ${signature}`);
                    return;
                }

                let tokenMint = null;
                let bondingCurve = null;
                let creator = 'UNKNOWN';
                let solInvested = 0;


                // Recherche dynamique de l'instruction "Create" de Pump.fun
                const pumpInstruction: any = tx.transaction.message.instructions.find(
                    (instr: any) => instr.programId.toBase58() === PUMPFUN_PROGRAM_ID && instr.accounts.length >= 8
                );
                if (!pumpInstruction) {
                    console.log(`[WebSocket Blockchain] Aucune instruction "Create" Pump.fun valide dans ${signature}`);
                    return;
                }
                tokenMint = pumpInstruction.accounts[0].toBase58();
                bondingCurve = pumpInstruction.accounts[2].toBase58();
                associatedbondingCurve = pumpInstruction.accounts[3].toBase58();
                creator = pumpInstruction.accounts[7].toBase58();



                //console.log(now(), `TOKEN MINT TONY : ${tokenMint}`);
                //console.log(now(), `TOKEN MINT : ${bondingCurve}`);
                //console.log(now(), `TOKEN MINT : ${creator}`);

                // Utiliser fetchTokenDetails pour obtenir name et symbol
                let name = 'Token_' + tokenMint.slice(0, 8); // Valeur par défaut
                let symbol = 'UNK'; // Valeur par défaut

                // Étape 2 : Aller directement à Inner Instruction Set #2, Inner Instruction #1 pour l’investissement
                if (tokenMint && tx.meta && tokenMint.endsWith('pump')) {
                    //console.log(`TOKEN MINT : ${tokenMint}`);
                    if (tx.meta.innerInstructions && tx.meta.innerInstructions.length > 2 && tx.meta.innerInstructions[2].instructions.length > 1) {
                        const investInstruction = tx.meta.innerInstructions[2].instructions[1];

                        // @ts-ignore
                        const parsed: any = investInstruction.parsed;

                        if (investInstruction.programId.equals(SYSTEM_PROGRAM) && parsed && parsed.type === 'transfer') {
                            const { source, lamports } = parsed.info;
                            //console.log(`[WebSocket Blockchain] Transfert détecté (inner #2, #1) - Source: ${source}, Montant: ${(lamports / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
                            if (source === creator) {
                                solInvested = lamports / LAMPORTS_PER_SOL;
                                //console.log(`[WebSocket Blockchain] Étape 2 - Créateur ${creator} a investi ${solInvested.toFixed(2)} SOL`);
                            } else {
                                //   console.log(`[WebSocket Blockchain] Source ${source} ne correspond pas au créateur ${creator}`);
                            }
                        } else {
                            // console.log(`[WebSocket Blockchain] Inner Instruction #2, #1 n’est pas un transfert valide`);
                        }
                    } else {
                        //  console.log(`[WebSocket Blockchain] Pas assez d’inner instructions pour atteindre Set #2, Instruction #1`);
                    }

                    if (solInvested < MIN_CREATOR_INVESTMENT) {
                        console.log(`[WebSocket Blockchain] Nouveau token Pump.fun détecté : ${tokenMint} à ${new Date().toISOString()} (Investissement: ${solInvested.toFixed(2)} SOL)`);
                        const token = {
                            mint: tokenMint,
                            name: name,
                            symbol: symbol,
                            bonding_curve: bondingCurve || 'UNKNOWN',
                            associated_bonding_curve: associatedbondingCurve || 'UNKNOWN',
                            creator: creator,
                        };
                        //await sniper(token, 'blockchain');
                    } else {
                        //console.log(`[WebSocket Blockchain] Token ${tokenMint} ignoré (investissement ${solInvested.toFixed(2)} SOL < ${MIN_CREATOR_INVESTMENT} SOL)`);
                    }
                } else {
                    console.log(`[WebSocket Blockchain] Aucun token "pump" valide dans ${signature}`);
                }
            }
        },
        'confirmed'
    );
}





async function testListen() {

    // Tony Mode
    listenForNewTokens()


    // Portal Mode
    const clientApi = new PumpWebsocketApi(new ServiceManager);

    clientApi.on('create', (data: CreateTokenTxResult) => {
        //console.log('New token created:', data.mint);

        console.log(now(), `TOKEN MINT API  : ${data.mint}`);
    });

    clientApi.start()


    // Frontend Mode
    const client = new PuppeteerWebSocketClient();

    client.on('create', (data: CreateTokenTxResult) => {
        //console.log('New token created:', data.mint);

        console.log(now(), `TOKEN MINT MAX  : ${data.mint}`);
    });

}


async function testBuy(tokenAddress: string, useJito?: boolean) {
    const token = { mint: new PublicKey(tokenAddress) };

    const wallet = Keypair.fromSecretKey(base58.decode(appConfig.solana.WalletPrivateKey));
    const connection = new Connection(appConfig.solana.rpc.helius)

    const jitoConnection = !useJito ? null : new Connection(appConfig.solana.rpc.jito, "processed");

    const tsStart = Date.now();
    const signature = await pumpFunBuy(connection, jitoConnection, wallet, token, 0.001, 5);
    const duration = Date.now() - tsStart;

    console.log("durée (ms):", duration);

    asserts(signature, `pas de signature trouvée`)

    const parsedSellTransaction: ParsedTransactionWithMeta | null = await fetchParsedTransactionWithRetries(connection, signature);
    return { signature, slot: parsedSellTransaction.slot }
}


async function testSell(tokenAddress: string, useJito?: boolean, minSlot=0) {
    const token = { mint: new PublicKey(tokenAddress) };

    const wallet = Keypair.fromSecretKey(base58.decode(appConfig.solana.WalletPrivateKey));
    const connection = new Connection(appConfig.solana.rpc.helius)

    const jitoConnection = !useJito ? null : new Connection(appConfig.solana.rpc.jito, "processed");

    const tsStart = Date.now();
    const tokenAmountRaw = await getTokenBalance(connection, wallet, token.mint.toBase58(), minSlot); // TODO: mettre un retry sur cette fonction
    const tokenAmount = Number(tokenAmountRaw) / (10 ** DEFAULT_DECIMALS);
    asserts(tokenAmount > 0, `balance token vide @ slot ${minSlot}`);
    console.log('balance:', tokenAmountRaw, tokenAmount)

    const signature = await pumpFunSell(connection, jitoConnection, wallet, token, tokenAmount, 5);
    const duration = Date.now() - tsStart;

    console.log("durée (ms):", duration);
}


async function main() {

    /*
    USAGE:
        ts-node src/pump_test_tony.ts --listen
        ts-node src/pump_test_tony.ts --buy
        ts-node src/pump_test_tony.ts --buy --jito
        ts-node src/pump_test_tony.ts --sell
        ts-node src/pump_test_tony.ts --sell --jito
        ts-node src/pump_test_tony.ts --buy --sell --jito
    */

    if (process.argv.includes('--listen')) {
        await testListen();
        return;
    }

    const tokenAddress = '3sbdZMTd1uEX9os46JXYqj5HRoR7cQ929Rqt2vvVpump';

    const useJito = process.argv.includes('--jito');
    let minSlot = 0;

    if (process.argv.includes('--buy')) {
        const {slot} = await testBuy(tokenAddress, useJito);
        minSlot = slot;
    }

    if (process.argv.includes('--buy') && process.argv.includes('--sell')) {
        await sleep(15_000);
    }

    if (process.argv.includes('--sell')) {
        await testSell(tokenAddress, useJito, minSlot);
    }
}

main();

