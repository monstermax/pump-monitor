// Trading.service.ts

import { Commitment, Connection, Finality, ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";

import { Token } from "../models/Token.model";
import { ServiceAbstract } from "./abstract.service";
import { appConfig } from "../../env";
import { getTokenBalance } from "../../lib/solana/account";
import { SellRecommandation } from "./Portfolio.service";
import { sendPortalBuyTransaction, sendPortalSellTransaction } from "../../lib/pumpfun/portal_tx/pumpfun_web_api";
import { OpportunityAnalysis } from "../analyzers/opportunity-analyzer";
import { PriorityFee, TransactionResult } from "../../lib/solana/solana_tx_sender";
import { fetchParsedTransactionWithRetries } from "../../lib/pumpfun/pumpfun_tx_tools";
import { decodeTradeTransactionFromLogs } from "../../lib/pumpfun/pumpfun_tx_decoder";
import { TradeTransactionResult } from "../../lib/pumpfun/pumpfun_trading";
import { pumpFunSell } from "../../lib/pumpfun/manual_tx/pumpfun_sell";
import { pumpFunBuy } from "../../lib/pumpfun/manual_tx/pumpfun_buy";

/* ######################################################### */



export interface TradingResult {
    success: boolean;
    txHash: string;
    solAmount: number;
    tokenAmount: number;
    error?: string;
}


/* ######################################################### */

const usePumpPortalTransactions = true;

export const MIN_BUY_SOL_AMOUNT = 0.01; // 1.5$

export const MIN_SELL_SOL_VALUE = 0.0001; // 0.015$
export const MIN_SELL_TOKEN_AMOUNT = 10_000;

/* ######################################################### */


export class TradingManager extends ServiceAbstract {
    private autoTrading: boolean = false;
    private pendingBuys = 0;
    private pendingSells = 0;
    private lastTradeSlot = 0;
    private connection: Connection = new Connection(appConfig.solana.rpc.helius, { commitment: 'confirmed' });


    start() {
        if (this.status !== 'stopped') return;
        super.start();


        // Vérifier les conditions de vente automatique toutes les 30 secondes
        this.intervals.checkAutoSellConditions = setInterval(async () => {
            if (this.autoTrading) {
                await this.checkAutoSellConditions();
            }
        }, 10_000);


        super.started();
    }


    /** Activer/désactiver le trading automatique */
    setAutoTrading(enabled: boolean): void {
        this.autoTrading = enabled;
        this.log(`Auto-trading ${enabled ? 'enabled' : 'disabled'}`);
    }


    isAutoTradingEnabled(): boolean {
        return this.autoTrading;
    }


    getPendingBuys() {
        return this.pendingBuys;
    }


    getPendingSells() {
        return this.pendingSells;
    }


    getLastTradeSlot() {
        return this.lastTradeSlot;
    }


    /** Acheter un token */
    async buyToken(token: Token, solAmountToSpend: number): Promise<TradingResult> {
        const portfolioSettings = await this.portfolio.getSettings();
        if (!portfolioSettings) throw new Error(`Paramètre Portfolio manquants`);

        this.pendingBuys++;

        try {

            if (solAmountToSpend <= 0) {
                return {
                    success: false,
                    txHash: '',
                    solAmount: 0,
                    tokenAmount: 0,
                    error: `Empty amount to buy`,
                };
            }

            if (token.boundingCurve.completed) {
                return {
                    success: false,
                    txHash: '',
                    solAmount: 0,
                    tokenAmount: 0,
                    error: `Bounding Curve completed !`,
                };

            }


            // Vérifier avec le portfolio manager si l'achat est possible
            //const availableAmount = this.portfolio.getBalanceSOL() - appConfig.trading.minSolInWallet;
            //const canBuyResult = availableAmount > 0.01 ? { canBuy: true } : { canBuy: false, reason: `Too many available funds` };

            const canBuyResult = this.portfolio.canSpendSolAmount(solAmountToSpend);

            if (!canBuyResult.canBuy) {
                return {
                    success: false,
                    txHash: '',
                    solAmount: 0,
                    tokenAmount: 0,
                    error: canBuyResult.reason,
                };
            }


            // Execute la transaction d'achat
            const slippage = 10; // 10%
            const transactionResult: TransactionResult = await this.executePumpFunBuy(token.address, solAmountToSpend, slippage);

            if (! transactionResult.success || ! transactionResult.signature) {
                throw new Error(`Echec d'achat de token. ${transactionResult.error}`);
            }

            this.lastTradeSlot = transactionResult.results?.slot ?? this.lastTradeSlot;

            this.success(`Achat du token ${token.address} confirmé`);
            this.log(`Solscan: https://solscan.io/tx/${transactionResult.signature}`);


            // Recupere la transaction
            //const parsedTransaction: ParsedTransactionWithMeta | null = await this.connection.getParsedTransaction(transactionResult.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });

            const onRetry = (attempt: number, elapsed: number) => {
                this.log(`Tentative ${attempt} d'obtenir la transaction d'achat (${elapsed}ms écoulées)...`);
            };

            const parsedTransaction: ParsedTransactionWithMeta | null = await fetchParsedTransactionWithRetries(this.connection, transactionResult.signature, onRetry);

            if (! parsedTransaction) {
                throw new Error(`Transaction non trouvée`);
            }


            // Decode la transaction
            const decodedInstruction: TradeTransactionResult | null = decodeTradeTransactionFromLogs(parsedTransaction);
            //console.log('decodedInstruction:', decodedInstruction)

            //const decodedInstructions = decodeParsedTransactionInfo(parsedTransaction, 0) as TradeDecodedInstruction[];
            //const decodedInstruction: TradeDecodedInstruction | undefined = decodedInstructions.find(instruction => ['buy', 'sell'].includes(instruction.type)) as TradeDecodedInstruction;

            if (! decodedInstruction) {
                //throw new Error(`Intruction d'achat non décodée => tx ${transactionResult.signature}`);
                this.warn(`Intruction d'achat non décodée => tx ${transactionResult.signature}`);
            }

            const { solAmount, tokenAmount } = decodedInstruction ?? { solAmount: solAmountToSpend, tokenAmount: solAmountToSpend * Number(token.price) }
            //const solAmount = decodedInstruction.solAmount;
            //const tokenAmount = decodedInstruction.tokenAmount;

            const txHash = transactionResult.signature ?? 'TX_HASH_MISSING';


            // Enregistrer l'achat dans le portfolio
            await this.portfolio.recordBuyTransaction(
                token,
                solAmount,
                tokenAmount,
                txHash,
            );

            return {
                success: true,
                txHash,
                solAmount,
                tokenAmount,
            };

        } catch (err: any) {
            this.error(`Error buying token ${token.address}: ${err.message}`);

            return {
                success: false,
                txHash: '',
                solAmount: 0,
                tokenAmount: 0,
                error: err.message,
            };

        } finally {
            this.pendingBuys--;
        }
    }


    /** Vendre un token */
    async sellToken(token: Token, tokenAmountToSell: number): Promise<TradingResult> {
        const wallet = this.portfolio.getWallet();
        if (!wallet) throw new Error(`Wallet non trouvé. Vente impossible`);

        this.pendingSells++;

        try {
            // Récupérer le holding de ce token
            const holding = this.db.getTokenHolding(token.address);

            if (!holding) {
                return {
                    success: false,
                    txHash: '',
                    solAmount: 0,
                    tokenAmount: 0,
                    error: `No holding found for token ${token.address}`,
                };
            }

            if (tokenAmountToSell <= 0) {
                return {
                    success: false,
                    txHash: '',
                    solAmount: 0,
                    tokenAmount: 0,
                    error: `Empty amount to sell`,
                };
            }

            if (token.boundingCurve.completed) {
                return {
                    success: false,
                    txHash: '',
                    solAmount: 0,
                    tokenAmount: 0,
                    error: `Bounding Curve completed !`,
                };
            }


            const realTokenBalanceLamports = await getTokenBalance(this.connection, wallet, token.address, this.lastTradeSlot);
            const realTokenBalance = Number(realTokenBalanceLamports) / 1e6;

            if (Math.abs(holding.amount - realTokenBalance) < 1) {
                //this.warn(`Adjust token balance. (holding: ${holding.amount.toFixed(6)}) / onchain: ${realTokenBalance.toFixed(6)}`);
                holding.amount = realTokenBalance;
            }


            // Vérifier si on a assez de tokens
            if (holding.amount < tokenAmountToSell) {
                if (tokenAmountToSell > 0.9 * holding.amount) {
                    tokenAmountToSell = holding.amount;

                } else {
                    return {
                        success: false,
                        txHash: '',
                        solAmount: 0,
                        tokenAmount: 0,
                        error: `Insufficient token balance. Required: ${tokenAmountToSell}, Available: ${holding.amount.toFixed(6)}`,
                    };
                }
            }


            // Execute la transaction de vente
            const slippage = 10; // 10%
            const transactionResult: TransactionResult = await this.executePumpFunSell(token.address, tokenAmountToSell, slippage);

            if (! transactionResult.success || ! transactionResult.signature) {
                throw new Error(`Echec de vente de token. ${transactionResult.error}`);
            }

            this.lastTradeSlot = transactionResult.results?.slot ?? this.lastTradeSlot;

            this.success(`Vente du token ${token.address} confirmée`);
            this.log(`Solscan: https://solscan.io/tx/${transactionResult.signature}`);


            // Recupere la transaction
            //const parsedTransaction: ParsedTransactionWithMeta | null = await this.connection.getParsedTransaction(transactionResult.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });

            const onRetry = (attempt: number, elapsed: number) => {
                this.log(`Tentative ${attempt} d'obtenir la transaction de vente (${elapsed}ms écoulées)...`);
            };

            const parsedTransaction: ParsedTransactionWithMeta | null = await fetchParsedTransactionWithRetries(this.connection, transactionResult.signature, onRetry);

            if (! parsedTransaction) {
                throw new Error(`Transaction non trouvée`);
            }


            // Decode la transaction
            const decodedInstruction: TradeTransactionResult | null = decodeTradeTransactionFromLogs(parsedTransaction);
            //console.log('decodedInstruction:', decodedInstruction)

            //const decodedInstructions = decodeParsedTransactionInfo(parsedTransaction, 0) as TradeDecodedInstruction[];
            //const decodedInstruction: TradeDecodedInstruction | undefined = decodedInstructions.find(instruction => ['buy', 'sell'].includes(instruction.type)) as TradeDecodedInstruction;

            if (! decodedInstruction) {
                //throw new Error(`Intruction de vente non décodée => tx ${transactionResult.signature}`);
                this.warn(`Intruction de vente non décodée => tx ${transactionResult.signature}`);
            }

            const { solAmount, tokenAmount } = decodedInstruction ?? { solAmount: tokenAmountToSell / Number(token.price), tokenAmount: tokenAmountToSell }
            //const solAmount = decodedInstruction.solAmount;
            //const tokenAmount = decodedInstruction.tokenAmount;

            const txHash = transactionResult.signature ?? 'TX_HASH_MISSING';


            // Enregistrer la vente dans le portfolio
            await this.portfolio.recordSellTransaction(
                token,
                solAmount,
                tokenAmount,
                txHash,
            );

            return {
                success: true,
                txHash,
                solAmount,
                tokenAmount,
            };

        } catch (err: any) {
            this.error(`Error selling token ${token.address}: ${err.message}`);

            return {
                success: false,
                txHash: '',
                solAmount: 0,
                tokenAmount: 0,
                error: err.message,
            };

        } finally {
            this.pendingSells--;
        }
    }


    // Vérifier si des conditions de vente automatique sont remplies
    async checkAutoSellConditions(): Promise<void> {
        try {
            // Récupérer les recommandations de vente
            const sellRecommendations: SellRecommandation[] = this.portfolio.checkHoldingsSellConditions();

            for (const recommendation of sellRecommendations) {
                const token = this.db.getTokenByAddress(recommendation.tokenAddress);

                if (token) {
                    this.autoSell(token, recommendation)
                }

            }

        } catch (err: any) {
            this.error(`Error checking auto-sell conditions: ${err.message}`);
        }
    }


    /** Achète un token de facon automatisée suite à une opportunité d'achat */
    async autoBuy(newToken: Token, opportunity: OpportunityAnalysis) {

        if (this.trading.getPendingBuys() > 0 || this.trading.getPendingSells() > 0) {
            return;
        }

        this.notice(`AUTO-BUY triggered for ${newToken.address} (Score: ${opportunity.score})`);

        // Vérifier si on peut acheter
        const canBuyResult = await this.portfolio.canAutoBuyToken(
            newToken.address,
            opportunity.score,
            opportunity.recommendedAmount
        );

        if (canBuyResult.canBuy) {
            // Exécuter l'achat automatique
            const result = await this.trading.buyToken(
                newToken,
                canBuyResult.recommendedAmount || opportunity.recommendedAmount
            );

            if (result.success && result.solAmount >= 0.001 && result.tokenAmount > 0.000_001) {
                this.success(`AUTO-BUY success: Bought ${result.tokenAmount} ${newToken.address} for ${result.solAmount.toFixed(4)} SOL`);
                this.emit('autobuy_success', newToken.address);

            } else {
                this.error(`AUTO-BUY failed: ${result.error}`);
                this.emit('autobuy_failed', newToken.address);
            }

        } else {
            this.log(`AUTO-BUY skipped: ${canBuyResult.reason}`);
        }
    }


    async autoSell(token: Token, recommendation: SellRecommandation) {
        const estimatedSolAmount = token ? recommendation.amount * Number(token.price) : 0;

        if (this.trading.getPendingBuys() > 0 || this.trading.getPendingSells() > 0) {
            return;
        }

        if (token && recommendation.amount > MIN_SELL_TOKEN_AMOUNT && estimatedSolAmount > MIN_SELL_SOL_VALUE) {
            this.notice(`AUTO-SELL triggered for ${recommendation.tokenAddress} - Reason: ${recommendation.reason}`);

            const canSellResult = this.portfolio.canAutoSellToken(token.address, recommendation.amount);

            if (!canSellResult.canSell) {
                this.warn(`AUTO-BUY skipped: ${canSellResult.reason}`);
                return;
            }

            // Exécuter la vente
            const result = await this.sellToken(token, recommendation.amount);

            if (result.success) {
                this.success(`AUTO-SELL success: Sold ${result.tokenAmount} ${recommendation.tokenSymbol} for ${result.solAmount.toFixed(4)} SOL`);
                this.emit('autosell_success', token.address);

            } else {
                this.error(`AUTO-SELL failed: ${result.error}`);
                this.emit('autosell_failed', token.address);
            }
        }
    }



    /** Implémentation de la logique d'achat sur pump.fun en utilisant l'API de Solana Web3.js et les instructions spécifiques à pump.fun */
    private async executePumpFunBuy(
        tokenAddress: string,
        solAmount: number,
        slippage = 5
    ): Promise<TransactionResult> {
        const wallet = this.portfolio.getWallet();

        if (!wallet) {
            throw new Error(`Pas de wallet disponible`);
        }

        if (!solAmount || solAmount < 0.001) {
            throw new Error(`Quantité invalide (${solAmount.toFixed(10)} SOL)`);
        }


        let result: TransactionResult;

        this.log(`Envoi d'une transaction d'achat de ${solAmount} SOL du token ${tokenAddress}`);

        if (usePumpPortalTransactions) {
            // Use Pump.fun Web API
            result = await sendPortalBuyTransaction(this.connection, wallet, tokenAddress, solAmount, slippage, 0.00001);

        } else {
            // Manually build & send transaction
            const mint = new PublicKey(tokenAddress);
            const priorityFees: PriorityFee | undefined = { unitLimit: 100_000, unitPrice: 100_000 };
            const commitment: Commitment | undefined = "confirmed";
            const finality: Finality | undefined = "confirmed";
            result = await pumpFunBuy(this.connection, wallet, mint, BigInt(Math.round(solAmount * 1e9)), BigInt(slippage*100), priorityFees, commitment, finality);
        }

        this.log(`Résultat de la transaction d'achat du token ${tokenAddress} => ${result.success ? result.signature : `ERROR : ${result.error}`}`);

        return result;
    }


    /** Implémentation de la logique de vente sur pump.fun en utilisant l'API de Solana Web3.js et les instructions spécifiques à pump.fun */
    private async executePumpFunSell(
        tokenAddress: string,
        tokenAmount: number,
        slippage = 5
    ): Promise<TransactionResult> {
        const wallet = this.portfolio.getWallet();

        if (!wallet) {
            throw new Error(`Pas de wallet disponible`);
        }

        if (!tokenAmount || tokenAmount <= 1) {
            throw new Error(`Quantité invalide (${tokenAmount} tokens)`);
        }


        let result: TransactionResult;

        this.log(`Envoi d'une transaction de vente de ${tokenAmount} $TOKEN du token ${tokenAddress}`);

        if (usePumpPortalTransactions) {
            // Use Pump.fun Web API
            result = await sendPortalSellTransaction(this.connection, wallet, tokenAddress, tokenAmount, slippage, 0.00001);

        } else {
            // Manually build & send transaction
            const mint = new PublicKey(tokenAddress);
            const priorityFees: PriorityFee | undefined = { unitLimit: 100_000, unitPrice: 100_000 };
            const commitment: Commitment | undefined = "confirmed";
            const finality: Finality | undefined = "confirmed";
            result = await pumpFunSell(this.connection, wallet, mint, BigInt(Math.round(tokenAmount * 1e6)), BigInt(slippage * 100), priorityFees, commitment, finality)
        }

        this.log(`Résultat de la transaction de vente pour le token ${tokenAddress} => ${result.success ? result.signature : `ERROR : ${result.error}`}`);

        return result;

    }



}


