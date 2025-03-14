// pump_bot_volume_sniper.ts

import { appConfig } from "./env";
import { sleep } from './lib/utils/time.util';
import { error, log, warn } from './lib/utils/console';
import { PumpFunIndexer } from "./monitor/services/PumpFunIndexer.service";
import { ServiceManager } from "./monitor/managers/Service.manager";
import { CreateTokenTxResult, TokenTradeTxResult } from "./monitor/services/PumpListener.service";
import { Connection, Keypair, ParsedTransactionWithMeta } from "@solana/web3.js";
import base58 from "bs58";
import { TransactionResult } from "./lib/solana/solana_tx_sender";
import { sendPortalBuyTransaction, sendPortalSellTransaction } from "./lib/pumpfun/portal_tx/pumpfun_portal_api";
import { convertToVersionedTransactionResponse, fetchParsedTransactionWithRetries } from "./lib/pumpfun/pumpfun_tx_tools";
import { TradeInfo, TransactionDecoder } from "./lib/pumpfun/pumpfun_tx_decoder";
import { sendPortalMultiBuyTransaction, sendPortalMultiSellTransaction } from "./lib/pumpfun/portal_tx/pumpfun_portal_api_jito";

/* ######################################################### */


/*
Résumé:
Ecouter en temps réel toutes les transactions Pump.fun et achèter les tokens montrant une tendance haussière sur deux slots consécutifs (ratio d'achats >60%, croissance du volume >20%), puis vendre rapidement aux premiers signes de faiblesse, généralement en quelques secondes à quelques minutes.


Détails:
La stratégie surveille en permanence tous les tokens Pump.fun, en conservant un historique des métriques clés sur les derniers slots (blocs). Pour chaque token, nous analysons:

Le ratio achats/ventes: nous privilégions les tokens où plus de 60% des transactions sont des achats
La croissance du volume: nous cherchons des tokens dont le volume d'échanges augmente d'au moins 20% entre deux slots
La marketCap: nous évitons les tokens trop petits (< 30 SOL)

Un score est attribué à chaque token en fonction de ces métriques, et dès qu'un token dépasse le score minimum, nous achetons immédiatement.
Après l'achat, nous surveillons étroitement le token et vendons rapidement si:

Le profit atteint +30% (prise de bénéfice)
La perte dépasse -5% (stop loss)
Le ratio d'achats tombe sous 50%
Aucune activité pendant 2 slots

Cette approche simplifiée permet d'être réactif sur un marché très volatile comme Pump.fun, en privilégiant la protection du capital et en capturant les mouvements haussiers rapides.
*/


/* ######################################################### */

// Types pour le suivi des tokens
type TokenMetrics = {
    buysCount: number;
    sellsCount: number;
    volumeSol: number;
    lastPrice: number;
    marketCap: number;
    lastTrade: TokenTradeTxResult | null;
};

/* ######################################################### */

const solAmount = 0.08;
const slippage = 15;
const portalPriorityFee = 0.0001;

const minSolInWallet = 0.1;
const maxDelayBeforeSell = 15;
const useJito = false;


// Configuration des seuils d'analyse et de trading
const CONFIG = {
    // Paramètres d'analyse des tokens
    HISTORY_LENGTH: 5,               // Nombre de slots d'historique à conserver
    MIN_TRADES_PER_SLOT: 3,          // Nombre minimum de trades dans un slot pour l'analyse
    MIN_MARKET_CAP: 40,              // MarketCap minimum en SOL
    MAX_MARKET_CAP: 80,              // MarketCap maximum en SOL
    MIN_HISTORY_SLOTS: 2,            // Nombre minimum de slots d'historique requis

    // Seuils pour sélection d'un token
    MIN_BUY_RATIO: 0.6,              // Ratio minimum d'achats (0.6 = 60%)
    MIN_VOLUME_GROWTH: 1.2,          // Croissance minimum du volume entre deux slots
    MIN_CANDIDATE_SCORE: 70,         // Score minimum pour qu'un token soit sélectionné

    // Pondération pour le calcul du score
    BUY_RATIO_WEIGHT: 60,            // Poids du ratio d'achats dans le score
    VOLUME_GROWTH_WEIGHT: 30,        // Poids de la croissance du volume dans le score
    MARKET_CAP_WEIGHT: 10,           // Poids de la marketCap dans le score (plafonné à 10)

    // Seuils pour décider de vendre
    TAKE_PROFIT_PERCENT: 30,         // Pourcentage de gain pour déclencher une prise de profit
    STOP_LOSS_PERCENT: -10,          // Pourcentage de perte pour déclencher un stop loss
    MIN_HOLDING_BUY_RATIO: 0.6,      // Ratio minimum d'achats pour maintenir une position
    MIN_HOLDING_TRADES: 3,           // Nombre minimum de trades pour évaluer le ratio pendant le holding
    MAX_INACTIVITY_SLOTS: 10,        // Nombre maximum de slots sans activité avant de vendre
};


const decoder = new TransactionDecoder;
let stopWaiting = false;
let selectedToken: string | null = null;
let isSelling = false;
let buyPrice = 0;

// Map pour stocker les informations de chaque token sur plusieurs slots
const tokenTrackers = new Map<string, Map<number, TokenMetrics>>();

/* ######################################################### */


async function main() {
    // ecouter les transactions (pas uniquement les tokens dont on a vu le mint)
    // chaque seconde, compter le nombre de trades/buy/sell => si bcp de buy d'un coup. on achete puis on revend 3 secondes plus tard


    log(`🤖 Sniper démarré 🚀`);

    const indexer = new PumpFunIndexer(new ServiceManager);

    //let currentBlockTime = 0;
    let currentSlot = 0;
    let blocksTrades: Map<string, TokenTradeTxResult[]> = new Map;


    indexer.on('create', async (newTokenData: CreateTokenTxResult, initialBuy?: TokenTradeTxResult) => {
        //log(`Mint ${newTokenData.mint} ${initialBuy ? `(dev ${initialBuy.solAmount.toFixed(3)} SOL)` : ''}`);

    })

    indexer.on('trade', async (tradeTokenData: TokenTradeTxResult, hasSeenMint?: boolean) => {
        //if (!hasSeenMint) return;
        //if (buying) return;
        //log(`Trade ${tradeTokenData.txType} ${tradeTokenData.mint} ${tradeTokenData.solAmount.toFixed(3)} SOL`);

        //const blockTime = tradeTokenData.timestamp.getTime();
        const slot = tradeTokenData.slot;

        if (slot !== currentSlot) {
            // on a changé de block (depuis le dernier trade recu)

            if (currentSlot) {
                // on a recu au moins 1 block complet
                const blockTrades = blocksTrades.get(tradeTokenData.mint);

                if (blockTrades) {
                    analyzeBlockTrades(currentSlot, blocksTrades);
                }
            }

            currentSlot = slot;
            blocksTrades = new Map;
        }

        const blockTrades = blocksTrades.get(tradeTokenData.mint) ?? [];
        blockTrades.push(tradeTokenData);

        blocksTrades.set(tradeTokenData.mint, blockTrades)

    })

    indexer.start();

}


// Mettre à jour les métriques du token pour le slot courant
function updateTokenMetrics(mint: string, slot: number, trades: TokenTradeTxResult[]) {
    if (!tokenTrackers.has(mint)) {
        tokenTrackers.set(mint, new Map());
    }

    const tokenHistory = tokenTrackers.get(mint)!;

    // Calculer les métriques
    const buysCount = trades.filter(trade => trade.txType === 'buy').length;
    const sellsCount = trades.filter(trade => trade.txType === 'sell').length;
    const volumeSol = trades.reduce((sum, trade) => sum + trade.solAmount, 0);
    const lastTrade = trades[trades.length - 1] || null;
    const lastPrice = lastTrade ? Number(lastTrade.price) : 0;
    const marketCap = lastTrade ? lastTrade.marketCapSol : 0;

    // Stocker les métriques
    tokenHistory.set(slot, {
        buysCount,
        sellsCount,
        volumeSol,
        lastPrice,
        marketCap,
        lastTrade
    });

    // Limiter l'historique
    const slots = Array.from(tokenHistory.keys()).sort((a, b) => b - a);
    while (slots.length > CONFIG.HISTORY_LENGTH) {
        tokenHistory.delete(slots.pop()!);
    }
}

// Analyser tous les tokens après chaque slot
function analyzeAllTokens(currentSlot: number): string | null {
    // Si déjà en train d'acheter/vendre
    if (selectedToken || isSelling) return null;

    // Trouver le meilleur candidat
    let bestCandidate: { mint: string, score: number } = { mint: '', score: 0 };

    for (const [mint, history] of tokenTrackers.entries()) {
        // Ignorer les tokens avec trop peu d'historique
        if (history.size < CONFIG.MIN_HISTORY_SLOTS) continue;

        // Récupérer les slots triés par ordre décroissant
        const slots = Array.from(history.keys()).sort((a, b) => b - a);
        const latestSlot = slots[0];
        const previousSlot = slots[1];

        // Récupérer les métriques
        const latestMetrics = history.get(latestSlot)!;
        const previousMetrics = history.get(previousSlot)!;

        // Ignorer si pas assez de trades dans le dernier slot
        if (latestMetrics.buysCount + latestMetrics.sellsCount < CONFIG.MIN_TRADES_PER_SLOT) continue;

        // Vérifier que la marketCap est suffisante
        if (latestMetrics.marketCap < CONFIG.MIN_MARKET_CAP || latestMetrics.marketCap > CONFIG.MAX_MARKET_CAP) continue;

        // Calculer le ratio buy/sell sur les deux derniers slots
        const totalBuys = latestMetrics.buysCount + previousMetrics.buysCount;
        const totalSells = latestMetrics.sellsCount + previousMetrics.sellsCount;
        const totalTrades = totalBuys + totalSells;
        const buyRatio = totalTrades > 0 ? totalBuys / totalTrades : 0;

        // Vérifier l'accélération du volume
        const volumeGrowth = previousMetrics.volumeSol > 0
            ? latestMetrics.volumeSol / previousMetrics.volumeSol
            : 1;

        // Calculer un score pour ce token
        // Favorise: haut ratio d'achats, volume croissant, marketCap raisonnable
        const score = buyRatio * CONFIG.BUY_RATIO_WEIGHT +
            volumeGrowth * CONFIG.VOLUME_GROWTH_WEIGHT +
            Math.min(latestMetrics.marketCap / 100, CONFIG.MARKET_CAP_WEIGHT);

        // Conditions minimales
        if (buyRatio < CONFIG.MIN_BUY_RATIO || volumeGrowth < CONFIG.MIN_VOLUME_GROWTH) continue;

        console.log(`Analyse ${mint}: buyRatio=${(buyRatio * 100).toFixed(1)}%, volumeGrowth=${volumeGrowth.toFixed(1)}x, score=${score.toFixed(1)}`);

        // Mettre à jour le meilleur candidat
        if (score > bestCandidate.score) {
            bestCandidate = { mint, score };
        }
    }

    // Si un bon candidat est trouvé, l'acheter immédiatement
    if (bestCandidate.score > CONFIG.MIN_CANDIDATE_SCORE) {
        console.log(`🔥 Token sélectionné: ${bestCandidate.mint} avec score ${bestCandidate.score.toFixed(1)}`);
        return bestCandidate.mint;
    }

    return null;
}

// Fonction pour surveiller un token après achat
function monitorToken(mint: string, currentSlot: number): boolean {
    const history = tokenTrackers.get(mint);
    if (!history) return false;

    const metrics = history.get(currentSlot);
    if (!metrics) return false;

    // Calculer la variation de prix depuis l'achat
    const priceDiff = metrics.lastPrice - buyPrice;
    const percentGain = buyPrice > 0 ? (priceDiff / buyPrice) * 100 : 0;

    // Calculer le ratio buy/sell dans le slot actuel
    const totalTrades = metrics.buysCount + metrics.sellsCount;
    const buyRatio = totalTrades > 0 ? metrics.buysCount / totalTrades : 0;

    console.log(`Monitoring ${mint}: gain=${percentGain.toFixed(2)}%, buyRatio=${(buyRatio * 100).toFixed(1)}%`);

    // Vendre si:
    // 1. Le gain dépasse le seuil de prise de profit
    if (percentGain > CONFIG.TAKE_PROFIT_PERCENT) {
        console.log(`⚡ Vente déclenchée: Profit atteint ${percentGain.toFixed(2)}%`);
        return true;
    }
    // 2. La perte dépasse le seuil de stop loss
    else if (percentGain < CONFIG.STOP_LOSS_PERCENT) {
        console.log(`🚨 Vente déclenchée: Stop loss ${percentGain.toFixed(2)}%`);
        return true;
    }
    // 3. Le ratio d'achat tombe sous le seuil minimum avec suffisamment de trades
    else if (buyRatio < CONFIG.MIN_HOLDING_BUY_RATIO && totalTrades >= CONFIG.MIN_HOLDING_TRADES) {
        console.log(`🚩 Vente déclenchée: Ratio d'achat faible ${(buyRatio * 100).toFixed(1)}%`);
        return true;
    }

    // Si aucun trade pendant X slots, vendre également
    const slots = Array.from(history.keys()).sort((a, b) => b - a);
    if (slots[0] < currentSlot - CONFIG.MAX_INACTIVITY_SLOTS) {
        console.log(`⏱️ Vente déclenchée: Inactivité pendant ${currentSlot - slots[0]} slots`);
        return true;
    }

    return false;
}

// Remplacer votre analyzeBlockTrades par cette fonction
function analyzeBlockTrades(currentSlot: number, blocksTrades: Map<string, TokenTradeTxResult[]>) {
    // Mettre à jour les métriques de tous les tokens qui ont des trades dans ce bloc
    for (const [mint, trades] of blocksTrades.entries()) {
        updateTokenMetrics(mint, currentSlot, trades);
    }

    // Si un token est sélectionné, le surveiller pour décider quand vendre
    if (selectedToken && !isSelling) {
        if (monitorToken(selectedToken, currentSlot)) {
            stopWaiting = true;
            isSelling = true;
        }
        return;
    }

    // Sinon, analyser tous les tokens pour trouver une opportunité d'achat
    const tokenToBuy = analyzeAllTokens(currentSlot);
    if (tokenToBuy) {
        selectedToken = tokenToBuy;
        buyAndSell(selectedToken);
    }
}


async function buyAndSell(tokenAddress: string) {
    const botWallet = Keypair.fromSecretKey(base58.decode(appConfig.solana.WalletPrivateKey));
    const connection = new Connection(appConfig.solana.rpc.chainstack);


    const onRetry = (attempt: number, elapsed: number) => {
        log(`Tentative ${attempt} d'obtenir la transaction (${elapsed}ms écoulées)...`);
    };

    const buyResult: TransactionResult = useJito
        ? await sendPortalMultiBuyTransaction(tokenAddress, [botWallet], [solAmount], slippage, portalPriorityFee)
        : await sendPortalBuyTransaction(connection, botWallet, tokenAddress, solAmount, slippage, portalPriorityFee);


    // ACHAT
    console.log()
    console.log(`🛒 ACHAT ${tokenAddress} ...`)
    console.log()
    console.log(`👉 https://pump.fun/coin/${tokenAddress}`)
    console.log()


    // 2) wait for transaction response

    if (!buyResult.success || !buyResult.signature) {
        warn(`Echec d'achat du token. ${buyResult.error}`);
        return;
    }

    console.log(`📨 Transaction d'achat envoyée => https://solscan.io/tx/${buyResult.signature}`);

    const parsedBuyTransaction: ParsedTransactionWithMeta | null = await fetchParsedTransactionWithRetries(connection, buyResult.signature, onRetry);

    if (!parsedBuyTransaction) {
        warn(`❌ Transaction d'achat non trouvée`);
        return;
    }


    console.log(`📥 Transaction d'achat réceptionnée`);

    const versionedBuyTx = convertToVersionedTransactionResponse(parsedBuyTransaction);
    const decodedBuyInstruction: TradeInfo = decoder.parseBuyInstruction(versionedBuyTx);

    if (!decodedBuyInstruction) {
        //throw new Error(`Intruction d'achat non décodée => tx ${transactionResult.signature}`);
        warn(`Intruction d'achat non décodée => tx ${buyResult.signature}`);
        return;
    }

    const tokenAmount = decodedBuyInstruction.tokenAmount;
    buyPrice = Number(decodedBuyInstruction.price);
    const buyAmount = decodedBuyInstruction.tokenAmount;

    //console.log(`Transaction d'achat décodée:`, decodedBuyInstruction);
    console.log(`📢 Transaction d'achat décodée => prix = ${decodedBuyInstruction.price} SOL`);


    // VENTE
    console.log()
    console.log(`🏷️ VENTE ${tokenAddress} ...`)
    console.log()


    for (let i = 0; i < maxDelayBeforeSell * 10; i++) {
        if (stopWaiting) break;
        await sleep(100);
    }

    console.log();
    isSelling = true;


    const sellResult: TransactionResult = useJito
        ? await sendPortalMultiSellTransaction(tokenAddress, [botWallet], [tokenAmount], slippage, portalPriorityFee)
        : await sendPortalSellTransaction(connection, botWallet, tokenAddress, tokenAmount, slippage, portalPriorityFee);


    // 2) wait for transaction response

    if (!sellResult.success || !sellResult.signature) {
        warn(`Echec de vente du token. ${sellResult.error}`);
        return;
    }

    console.log(`📨 Transaction de vente envoyée => https://solscan.io/tx/${buyResult.signature}`);

    const parsedSellTransaction: ParsedTransactionWithMeta | null = await fetchParsedTransactionWithRetries(connection, sellResult.signature, onRetry);

    if (!parsedSellTransaction) {
        warn(`❌ Transaction de vente non trouvée`);
        return;
    }


    console.log(`📥 Transaction de vente réceptionnée`);

    const versionedSellTx = convertToVersionedTransactionResponse(parsedSellTransaction);
    const decodedSellInstruction: TradeInfo = decoder.parseSellInstruction(versionedSellTx);

    if (!decodedSellInstruction) {
        //throw new Error(`Intruction de vente non décodée => tx ${transactionResult.signature}`);
        warn(`Intruction de vente non décodée => tx ${sellResult.signature}`);
        return;
    }

    //console.log(`Transaction de vente décodée:`, decodedSellInstruction);
    console.log(`📢 Transaction de vente décodée => prix = ${decodedSellInstruction.price} SOL`);

    const diff = decodedSellInstruction.traderPostBalanceSol - decodedBuyInstruction.traderPreBalanceSol;

    console.log(`Before: ${decodedBuyInstruction.traderPreBalanceSol.toFixed(3)} SOL`);
    console.log(`After: ${decodedSellInstruction.traderPostBalanceSol.toFixed(3)} SOL`);

    if (diff > 0) {
        console.log(`😎 Gain: ${diff.toFixed(3)} SOL`);

    } else if (diff < 0) {
        console.log(`😭 Perte: ${diff.toFixed(3)} SOL`);

    } else {
        console.log(`😔 NOOP: ${diff.toFixed(3)} SOL`);
    }

    if (decodedSellInstruction.traderPostBalanceSol <= minSolInWallet) {
        process.exit();
    }

    await sleep(5000);


    // Reset all et relancer un cycle
    console.log();
    console.log(`🔁 Lancement d'un nouveau cycle...`);
    console.log();
    console.log('#'.repeat(80));
    console.log();

    resetState();
}


// Reset les variables globales
function resetState() {
    // Variables pour le cycle d'achat/vente
    selectedToken = null;
    isSelling = false;
    stopWaiting = false;
    buyPrice = 0;

    // Les variables suivantes n'existent plus dans la nouvelle approche
    // et peuvent être supprimées ou adaptées:
    // preSelectedToken = null;
    // blockWithoutSelectedTokenTrades = 0;
    // preSelectedTokenConfirmations = 0;
    
    console.log("État réinitialisé, prêt pour un nouveau cycle de trading.");
}



/* ######################################################### */


// Démarrer le programme
main().catch((err: any) => {
    error('Erreur fatale:', err);
    process.exit(1);
});


