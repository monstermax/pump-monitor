
import fs from 'fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, ParsedTransactionWithMeta, Cluster, Logs, Context } from '@solana/web3.js';
import * as ed25519 from 'ed25519-hd-key';
import { sleep } from '../utils/time.util';
import { TradeLog } from '../pumpfun/pumpfun_tx_decoder';
import { pumpFunBuy } from '../pumpfun/manual_tx/pumpfun_buy';
import { pumpFunSell } from '../pumpfun/manual_tx/pumpfun_sell';
import { getFormattedTokenBalance, getVaultCreatorPubkey } from '../pumpfun/manual_tx/pumpfun_common';


// Phantom accounts derivation path : https://help.phantom.com/hc/en-us/articles/12988493966227-What-derivation-paths-does-Phantom-wallet-support

// main wallet : https://solscan.io/account/BpppcqJXTfF2ZxU9YW8g7iaNrNYjBDs8vPq4xrpogBcL?cluster=devnet

/*

Prix = k × (supply)^n
- k : constante du token
- n : exposant de la courbe (généralement >1, souvent ~1.5 à 2 sur Pump.fun)
- supply : nombre total de tokens mintés
=> Chaque achat augmente supply, donc le prix monte de façon exponentielle.

*/


type Action = 'subWalletsDeposit' | 'subWalletsWithdraw' | 'subWalletsWithdrawOverlap' | 'listenAddress';

type Buyer = {
    keypair: Keypair,
    balanceSOL: number,
    balanceToken: number | null;
    status: 'idle' | 'ready-to-buy' | 'buying' | 'buying-wait-tx' | 'buy-done' | 'buy-error' | 'selling' | 'selling-wait-tx' | 'sell-done' | 'sell-error';
};

type MainStatus = 'idle' | 'buying' | 'ready-to-sell' | 'selling';


const cluster: Cluster = 'mainnet' as Cluster;

const maxSubWallets = 10;
const minBalancePerSubWallet = 0.1;
const defaultBuyAmount = 0.02;
const nbBuyPerSubwallet = 2;
const buyDuration = 5 * maxSubWallets;
const sellDuration = 0;
const pumpProgramId = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const defaultFeeAmount = 0.001;
let mainStatus: MainStatus = 'idle';


async function main() {

    const rpcUrl = (cluster === 'devnet')
        ? `https://devnet.helius-rpc.com/?api-key=c7a861b9-919e-467f-b3b7-66ca8b3fcb69`
        : `https://mainnet.helius-rpc.com/?api-key=c7a861b9-919e-467f-b3b7-66ca8b3fcb69`;

    let action: Action | null = null;

    if (process.argv.includes('--deposit')) action = 'subWalletsDeposit';
    if (process.argv.includes('--withdraw-all')) action = 'subWalletsWithdraw';
    if (process.argv.includes('--withdraw')) action = 'subWalletsWithdrawOverlap';
    if (process.argv.includes('--listen')) action = 'listenAddress';

    const connection = new Connection(rpcUrl);

    const mainPrivateKey = fs.readFileSync('/tmp/devwal-sol-pump.tst').toString().trim();
    const mainKeypair = await createDeterministicSubWallet(mainPrivateKey);
    const mainKeypairPublicKey = mainKeypair.publicKey;

    const balanceLamports = await connection.getBalance(mainKeypairPublicKey);
    const balance = balanceLamports / 1e9;
    console.log('mainKeypair:', mainKeypairPublicKey.toBase58(), `=> ${balance.toFixed(9)} SOL`);

    let buyers: Record<number, Buyer> = {};
    let totalBalance = balance;


    // Show balances (+ deposit/withdraw optional actions)

    const subKeypairs: Keypair[] = [];

    for (let i = 0; i < maxSubWallets; i++) {
        let subKeypair = subKeypairs[i];

        if (!subKeypair) {
            subKeypair = await createDeterministicSubWallet(mainPrivateKey, i);
            subKeypairs[i] = subKeypair;

            const subKeyPublicKey = subKeypair.publicKey;

            const balanceLamports = await connection.getBalance(subKeyPublicKey);
            const balance = balanceLamports / 1e9;
            totalBalance += balance;

            console.log(`subKeypair[${i}] :`, subKeyPublicKey.toBase58(), `=> ${balance.toFixed(9)} SOL`);


            if (action === 'subWalletsDeposit' && balance < minBalancePerSubWallet) {
                const transferAmount = minBalancePerSubWallet - balance; // on comble ce qui manque
                const transferAmountLamports = Math.floor(transferAmount * 1e9);
                await deposit(connection, mainKeypair, subKeyPublicKey, transferAmountLamports);
            }


            if (action === 'subWalletsWithdraw' && balance > 0) {
                // Withdraw all
                const transferAmountLamports = balanceLamports; // on vide tout le wallet
                await withdraw(connection, mainKeypair, subKeypair, transferAmountLamports);
            }

            if (action === 'subWalletsWithdrawOverlap' && balance > minBalancePerSubWallet) {
                // Withdraw overlap
                const transferAmount = balance - minBalancePerSubWallet; // on retire ce qui est en trop
                const transferAmountLamports = Math.floor(transferAmount * 1e9);
                await withdraw(connection, mainKeypair, subKeypair, transferAmountLamports);
            }

            const buyerStatus = (balance === 0) ? 'idle' : 'ready-to-buy';
            buyers[i] = { keypair: subKeypair, balanceSOL: balance, balanceToken: null, status: buyerStatus };

            await sleep(100);
        }
    }

    console.log('totalBalance:', totalBalance.toFixed(9), 'SOL');


    if (action === 'listenAddress') {
        const onTransaction = (context: Context, logs: Logs, tx?: ParsedTransactionWithMeta) => {
            const isPumpFun = logs.logs.some((log => log.startsWith(`Program ${pumpProgramId}`)))
            const hasBuy = logs.logs.some((log => log.includes('Instruction: Buy')))
            const hasSell = logs.logs.some((log => log.includes('Instruction: Sell')))

            if (isPumpFun && (hasBuy || hasSell)) {
                const logData = logs.logs.find(log => log.startsWith('Program data: '))

                if (logData) {
                    const logDataDecoded = parseTradeEvent(logData);
                    console.log('logDataDecoded:', logDataDecoded);

                    if (logDataDecoded && logDataDecoded.isBuy) {
                        // buy
                        massBuy(connection, mainKeypair, buyers, new PublicKey(logDataDecoded.mint), buyDuration);

                    } else if (logDataDecoded && !logDataDecoded.isBuy) {
                        // sell
                        massSell(connection, mainKeypair, buyers, new PublicKey(logDataDecoded.mint), sellDuration);
                    }
                }
            }
        }

        const mainWalletListener = watchAddress(connection, mainKeypairPublicKey.toBase58(), onTransaction);


        for (const buyer of Object.values(buyers)) {
            const onSubWalletTransaction = async (context: Context, logs: Logs, tx?: ParsedTransactionWithMeta) => {
                const logData = logs.logs.find(log => log.startsWith('Program data: '))

                console.log(`LOG:`, logs)

                if (logData) {
                    const logDataDecoded = parseTradeEvent(logData);

                    if (logDataDecoded.isBuy) {
                        // buy
                        buyer.balanceToken = (buyer.balanceToken || 0) + logDataDecoded.tokenAmount;
                        buyer.balanceSOL -= logDataDecoded.solAmount;

                    } else {
                        // sell
                        buyer.balanceToken = (buyer.balanceToken || 0) - logDataDecoded.tokenAmount;
                        buyer.balanceSOL += logDataDecoded.solAmount;
                    }

                    // TODO: recuperer les balances reeles (token + SOL)
                }
            }

            const subWalletListener = watchAddress(connection, buyer.keypair.publicKey.toBase58(), onSubWalletTransaction);
        }


        return;
    }



    if (1) {
        const tokenMint = new PublicKey('Gttf8qaCkxtRzq1Y9Kg5TPyRXPNA7ptNJPvwWxoApump');
        const vaultPubkey = await getVaultCreatorPubkey(connection, tokenMint);
        console.log('vaultPubkey:', vaultPubkey?.toBase58())
    }

}


async function createDeterministicSubWallet(
    masterPrivateKey: string,
    nonce: number | string | null = null,
    derivationPath = `m/44'/501'/${Number(nonce)}'/0'`
): Promise<Keypair> {

    if (nonce === null) {
        const seed = Uint8Array.from(bs58.decode(masterPrivateKey));
        return Keypair.fromSeed(seed.slice(0, 32));
    }

    // Dériver la clé à partir du chemin
    const derivedSeed = ed25519.derivePath(derivationPath, masterPrivateKey).key;

    // Créer un Keypair Solana à partir de la clé dérivée
    const keypair = Keypair.fromSeed(derivedSeed.slice(0, 32));

    return keypair;
}


async function deposit(connection: Connection, mainKeypair: Keypair, subKeyPublicKey: PublicKey, transferAmountLamports: number) {
    const tx = new Transaction;

    const transferInstruction = SystemProgram.transfer({
        fromPubkey: mainKeypair.publicKey,
        toPubkey: subKeyPublicKey,
        lamports: transferAmountLamports,
    });

    tx.add(transferInstruction);

    const signature = await connection.sendTransaction(tx, [mainKeypair], { skipPreflight: false })
    console.log(`tx: https://solscan.io/tx/${signature}?cluster=${cluster}`)
}


async function withdraw(connection: Connection, mainKeypair: Keypair, subKeypair: Keypair, transferAmountLamports: number) {
    const tx = new Transaction;

    const transferInstruction = SystemProgram.transfer({
        fromPubkey: subKeypair.publicKey,
        toPubkey: mainKeypair.publicKey,
        lamports: transferAmountLamports,
    });

    tx.add(transferInstruction);

    const signature = await connection.sendTransaction(tx, [mainKeypair, subKeypair], { skipPreflight: false })
    console.log(`tx: https://solscan.io/tx/${signature}?cluster=${cluster}`)
}


async function watchAddress(connection: Connection, address: string, callback?: (context: Context, logs: Logs, tx?: ParsedTransactionWithMeta) => void) {
    const publicKey = new PublicKey(address);

    console.log(`Surveillance des transactions pour l'adresse: ${address}`);

    // S'abonner aux transactions
    const subscriptionId = connection.onLogs(
        publicKey,
        async (logs, context) => {
            console.log('Nouvelle transaction détectée:', logs.signature);
            //console.log('context:', context);
            //console.log('Logs:', logs);

            if (logs.signature === '1111111111111111111111111111111111111111111111111111111111111111') {
                return;
            }

            if (logs.err) {
                console.log('Logs:', logs);
            }

            const signature = logs.signature;

            if (callback) {
                callback(context, logs);
            }

            if (0) {
                const tx = await getTransaction(connection, signature);
                //console.log('tx:', tx);

                if (tx && callback) {
                    callback(context, logs, tx);
                }
            }
        },
        'confirmed' // Niveau de confirmation
    );

    console.log(`Abonnement actif avec ID: ${subscriptionId}`);

    // Retourner une fonction pour se désabonner
    return {
        stop: () => {
            connection.removeOnLogsListener(subscriptionId);
            console.log('Surveillance arrêtée');
        },
    };
}


async function getTransaction(connection: Connection, signature: string, retries = 30, delay = 1000) {
    let tx: ParsedTransactionWithMeta | null = null;

    while (true) {
        tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
        //console.log('tx:', tx);
        if (tx) break;
        retries--;
        if (retries <= 0) break;
        await sleep(delay);
    }

    return tx;
}


async function massBuy(connection: Connection, mainKeypair: Keypair, buyers: Record<number, Buyer>, mint: PublicKey, duration = 30) {
    console.log('massBuy');

    if (mainStatus !== 'idle') return;

    mainStatus = 'buying';

    const buyersList = Object.values(buyers).sort(() => Math.random() - 0.5);

    const dateStart = Date.now();
    const avgDuration = duration / buyersList.length;
    //const avgDurationHalf = avgDuration / 2;
    const avgDurationDouble = avgDuration * 2;

    const slippage = 15;
    let buyersDone = 0;

    for (const buyer of buyersList) {
        const dateNow = Date.now();
        const elapsedTime = dateNow - dateStart;
        const remainingBuyers = buyersList.length - buyersDone;
        const remainingDuration = duration - elapsedTime;

        //const randomDuration = randomInt(avgDurationHalf, avgDurationDouble);

        const avgRemainingDuration = remainingDuration / remainingBuyers;

        const randomDuration = (remainingBuyers === 1)
            ? remainingDuration
            : randomInt(avgRemainingDuration / 2, Math.min(avgDurationDouble, remainingDuration / 2));

        await sleep(randomDuration * 1000);

        let runningSOL = 0;


        for (let k=1; k<=nbBuyPerSubwallet; k++) {
            if (mainStatus !== 'buying') {
                break;
            }


            if (buyer.status === 'ready-to-buy' && buyer.balanceSOL - runningSOL > defaultFeeAmount) {
                console.log(time(), 'BUY with', buyer.keypair.publicKey.toBase58(), 'for', buyer.balanceSOL.toFixed(9), 'SOL');

                buyer.status = 'buying';

                try {
                    //const buyAmount = buyer.balanceSOL - defaultFeeAmount;
                    const buyAmount = defaultBuyAmount * randomInt(50, 300) / 100;

                    // 1. send buy tx
                    const signature = await pumpFunBuy(connection, null, buyer.keypair, { mint }, buyAmount, slippage);
                    console.log(`buy tx with ${buyer.keypair.publicKey.toBase58()} : https://solscan.io/tx/${signature}?cluster=${cluster}`);

                    buyer.status = 'buy-done';
                    runningSOL += buyAmount + defaultFeeAmount;

                } catch (err: any) {
                    console.warn(`buy-error with ${buyer.keypair.publicKey.toBase58()} : ${err.message}`);
                    buyer.status = 'buy-error';
                }
            }

            await sleep(randomDuration / 3);
        }


        if (mainStatus !== 'buying') {
            break;
        }

        buyersDone++;
    }

    if (mainStatus === 'buying') {
        mainStatus = 'ready-to-sell';
    }
}


async function massSell(connection: Connection, mainKeypair: Keypair, buyers: Record<number, Buyer>, mint: PublicKey, duration = 30) {
    console.log('massSell');

//    if (mainStatus !== 'buying' && mainStatus !== 'ready-to-sell') return;

    mainStatus = 'selling';

    const buyersList = Object.values(buyers).sort(() => Math.random() - 0.5);

    const dateStart = Date.now();
    const avgDuration = duration / buyersList.length;
    //const avgDurationHalf = avgDuration / 2;
    const avgDurationDouble = avgDuration * 2;

    const slippage = 15;
    let buyersDone = 0;

    for (const buyer of buyersList) {
        const dateNow = Date.now();
        const elapsedTime = dateNow - dateStart;
        const remainingBuyers = buyersList.length - buyersDone;
        const remainingDuration = duration - elapsedTime;

        const avgRemainingDuration = remainingDuration / remainingBuyers;

        const randomDuration = (remainingBuyers === 1)
            ? remainingDuration
            : randomInt(avgRemainingDuration / 2, Math.min(avgDurationDouble, remainingDuration / 2));

        //const randomDuration = randomInt(avgDurationHalf, avgDurationDouble);

        await sleep(randomDuration);


        if (mainStatus !== 'selling') {
            break;
        }

        //const sellAmount = buyer.balanceToken;
        const sellAmount = await getFormattedTokenBalance(connection, buyer.keypair.publicKey.toBase58(), mint.toBase58()) || buyer.balanceToken;
        //const sellAmount = buyer.balanceToken;


        if ( /* buyer.status === 'buy-done' && */ sellAmount && sellAmount > 0) {
            console.log(time(), 'SELL with', buyer.keypair.publicKey.toBase58(), 'for', sellAmount.toFixed(6), 'Token');

            buyer.status = 'selling';

            try {
                if (sellAmount) {
                    // 1. send sell tx
                    const signature = await pumpFunSell(connection, null, buyer.keypair, { mint }, sellAmount, slippage);
                    console.log(`sell tx with ${buyer.keypair.publicKey.toBase58()} : https://solscan.io/tx/${signature}?cluster=${cluster}`);
                }

                buyer.status = 'sell-done';

            } catch (err: any) {
                console.warn(`sell-error with ${buyer.keypair.publicKey.toBase58()} : ${err.message}`);
                buyer.status = 'sell-error';
            }
        }


        buyersDone++;
    }

    if (mainStatus === 'selling') {
        mainStatus = 'idle';
    }
}


function randomInt(min: number, max: number) {
    return Math.floor(min + Math.random() * (max - min));
}


function time(d = new Date) {
    return d.toLocaleTimeString();
}


export function parseTradeEvent(tradeEventLog: string): TradeLog {

    //const tradeEventDiscriminator = [189, 219, 127, 211, 78, 230, 97, 238]; // vdt/007mYe4 (mais pb quand signature commence par "vdt/007mYe5")
    //const tradeEventSignature = Buffer.from(tradeEventDiscriminator).toString('base64').replace(/=+$/, '');
    const tradeEventSignature = "vdt/007mYe";

    if (!tradeEventLog.startsWith(`Program data: ${tradeEventSignature}`)) {
        throw new Error(`Signature invalide. Impossible de décoder les données`);
    }


    // Décoder les données Base64
    const prefix = "Program data: ";
    const base64Data = tradeEventLog.substring(tradeEventLog.indexOf(prefix) + prefix.length);
    const rawData = Buffer.from(base64Data, 'base64');

    // La signature de l'événement est dans les 8 premiers octets (ignorer pour la flexibilité)
    let offset = 8;

    // Lire la clé publique du token (mint)
    const mint = new PublicKey(Buffer.from(rawData.slice(offset, offset + 32))).toBase58();
    offset += 32;

    // Lire le montant de SOL (u64)
    const solAmount = Number(rawData.readBigUInt64LE(offset)) / 1e9; // Convertir lamports en SOL
    offset += 8;

    // Lire le montant de tokens (u64)
    const tokenAmount = Number(rawData.readBigUInt64LE(offset)) / 1e6; // Convertir en tokens selon decimals
    offset += 8;

    // Lire le flag isBuy (boolean)
    const isBuy = rawData[offset] === 1;
    offset += 1;

    // Lire la clé publique de l'utilisateur
    const user = new PublicKey(Buffer.from(rawData.slice(offset, offset + 32))).toBase58();
    offset += 32;

    // Lire le timestamp (i64)
    const timestamp = Number(rawData.readBigInt64LE(offset));
    offset += 8;

    // Lire les réserves virtuelles de SOL (u64)
    const virtualSolReserves = Number(rawData.readBigUInt64LE(offset)) / 1e9;
    offset += 8;

    // Lire les réserves virtuelles de tokens (u64)
    const virtualTokenReserves = Number(rawData.readBigUInt64LE(offset)) / 1e6;
    offset += 8;

    // Lire les réserves réelles de SOL (u64)
    const realSolReserves = Number(rawData.readBigUInt64LE(offset)) / 1e9;
    offset += 8;

    // Lire les réserves réelles de tokens (u64)
    const realTokenReserves = Number(rawData.readBigUInt64LE(offset)) / 1e6;

    //console.log(`Réserves extraites - Virtuelles: ${virtualSolReserves} SOL / ${virtualTokenReserves} tokens, Réelles: ${realSolReserves} SOL / ${realTokenReserves} tokens`);

    const result: TradeLog = {
        mint,
        solAmount,
        tokenAmount,
        isBuy,
        user,
        timestamp,
        virtualSolReserves,
        virtualTokenReserves,
        realSolReserves,
        realTokenReserves,
    };

    return result;
}


main();

