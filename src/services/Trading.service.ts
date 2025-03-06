// Trading.service.ts

import { Commitment, Finality, ParsedTransactionWithMeta, PublicKey, VersionedTransactionResponse } from "@solana/web3.js";

import { Token } from "../models/Token.model";
import { ServiceAbstract } from "./abstract.service";
import { MagicConnection } from "../lib/solana/MagicConnection";
import { appConfig } from "../env";
import { getTokenBalance } from "../lib/solana/account";
import { SellRecommandation } from "./Portfolio.service";
import { sendPortalBuyTransaction, sendPortalSellTransaction } from "../lib/pumpfun/pumpfun_api_tx";
import { decodeTransaction } from "../lib/pumpfun/pumpfun_tx";

/* ######################################################### */


export type TransactionResult = {
    signature?: string;
    error?: unknown;
    results?: VersionedTransactionResponse;
    success: boolean;
};


export type PriorityFee = {
    unitLimit: number;
    unitPrice: number;
};


export interface TradingResult {
    success: boolean;
    txHash: string;
    solAmount: number;
    tokenAmount: number;
    error?: string;
}

/* ######################################################### */


export class TradingManager extends ServiceAbstract {
    private autoTrading: boolean = false;
    private pendingBuys = 0;
    private pendingSells = 0;
    private magicConnection: MagicConnection = new MagicConnection({ rpcs: Array.from(new Set(Object.values(appConfig.solana.rpc))) });


    start() {
        if (this.status !== 'stopped') return;
        super.start();


        // Vérifier les conditions de vente automatique toutes les 30 secondes
        this.intervals.checkAutoSellConditions = setInterval(async () => {
            if (this.autoTrading) {
                const holdings = this.db.getAllHoldings()
                const holdingsAddresses = holdings.map(holding => holding.tokenAddress);

                const tokens = this.db.selectTokens()
                    .filter(token => holdingsAddresses.includes(token.address));

                await this.checkAutoSellConditions(tokens);
            }
        }, 10_000);


        super.started();
    }


    /** Activer/désactiver le trading automatique */
    setAutoTrading(enabled: boolean): void {
        this.autoTrading = enabled;
        console.log(`Auto-trading ${enabled ? 'enabled' : 'disabled'}`);
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


    /** Acheter un token */
    async buyToken(token: Token, solAmountToSpend: number): Promise<TradingResult> {
        const portfolioSettings = await this.portfolio.getSettings();
        if (!portfolioSettings) throw new Error(`Paramètre Portfolio manquants`);

        try {
            // Vérifier le solde du wallet avant d'acheter
            const walletBalance = await this.portfolio.getBalanceSOL();
            const availableWalletBalance = walletBalance - portfolioSettings.minSolInWallet;

            if (solAmountToSpend <= 0) {
                return {
                    success: false,
                    txHash: '',
                    solAmount: 0,
                    tokenAmount: 0,
                    error: `Empty amount to buy`,
                };
            }

            if (availableWalletBalance < solAmountToSpend) {
                return {
                    success: false,
                    txHash: '',
                    solAmount: 0,
                    tokenAmount: 0,
                    error: `Insufficient SOL balance. Required: ${solAmountToSpend}, Available: ${walletBalance.toFixed(4)}, Safety: ${portfolioSettings.minSolInWallet}`,
                };
            }

            // Vérifier avec le portfolio manager si l'achat est possible
            //const availableAmount = this.portfolio.getBalanceSOL() - appConfig.trading.minSolInWallet;
            //const canBuyResult = availableAmount > 0.01 ? { canBuy: true } : { canBuy: false, reason: `Too many available funds` };

            const canBuyResult = this.portfolio.canBuyToken(
                token.address,
                80, // Simulation d'un score
                solAmountToSpend
            );

            if (!canBuyResult.canBuy) {
                return {
                    success: false,
                    txHash: '',
                    solAmount: 0,
                    tokenAmount: 0,
                    error: canBuyResult.reason,
                };
            }

            this.pendingBuys++;


            // Execute la transaction d'achat
            const slippage = 5 * 100; // 5%
            const transactionResult: TransactionResult = await this.executePumpFunBuy(token.address, solAmountToSpend, slippage);

            if (! transactionResult.success || ! transactionResult.signature) {
                // erreur possible: "Error Code: TooMuchSolRequired. Error Number: 6002. Error Message: slippage: Too much SOL required to buy the given amount of tokens.."
                //await this.portfolio.updateBalanceSol();
                //await this.portfolio.updateHoldingBalance(token.address, 'buy');
                throw new Error(`Echec de vente de token. ${transactionResult.error}`);
            }


            // Recupere et décode la transaction
            const parsedTransaction: ParsedTransactionWithMeta | null = await this.magicConnection.getParsedTransaction(transactionResult.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
            //const parsedTransaction: ParsedTransactionWithMeta | null = await getParsedTransaction(rpcs, transactionResult.signature);

            if (! parsedTransaction) {
                throw new Error(`Transaction non trouvée`);
            }

            const decodedInstruction = decodeTransaction(parsedTransaction);
            //console.log('decodedInstruction:', decodedInstruction)

            //const decodedInstructions = decodeParsedTransactionInfo(parsedTransaction, 0) as TradeDecodedInstruction[];
            //const decodedInstruction: TradeDecodedInstruction | undefined = decodedInstructions.find(instruction => ['buy', 'sell'].includes(instruction.type)) as TradeDecodedInstruction;

            if (! decodedInstruction) {
                throw new Error(`Intruction décodée non trouvée`);
            }


            const solAmount = decodedInstruction.sol_amount; // / 1e9;
            const tokenAmount = decodedInstruction.token_amount; // / 1e6;

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
            console.error(`Error buying token ${token.symbol}:`, err);
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

        try {
            // Récupérer le holding de ce token
            const holding = this.db.getTokenHolding(token.address);

            if (!holding) {
                return {
                    success: false,
                    txHash: '',
                    solAmount: 0,
                    tokenAmount: 0,
                    error: `No holding found for token ${token.symbol}`,
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

            const realTokenBalanceLamports = await getTokenBalance(this.magicConnection, wallet, token.address);
            const realTokenBalance = Number(realTokenBalanceLamports) / 1e6;

            if (holding.amount !== realTokenBalance) {
                console.warn(`Adjust token balance. (holding: ${holding.amount.toFixed(6)}) / onchain: ${realTokenBalance.toFixed(6)}`);
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

            this.pendingSells++;


            // Execute la transaction de vente
            const slippage = 10 * 100; // 10%
            const transactionResult: TransactionResult = await this.executePumpFunSell(token.address, tokenAmountToSell, slippage);

            if (! transactionResult.success || ! transactionResult.signature) {
                //await this.portfolio.updateBalanceSol();
                //await this.portfolio.updateHoldingBalance(token.address, 'sell');
                throw new Error(`Echec de vente de token. ${transactionResult.error}`);
            }


            // Recupere et décode la transaction
            const parsedTransaction: ParsedTransactionWithMeta | null = await this.magicConnection.getParsedTransaction(transactionResult.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
            //const parsedTransaction: ParsedTransactionWithMeta | null = await getParsedTransaction(rpcs, transactionResult.signature);

            if (! parsedTransaction) {
                throw new Error(`Transaction non trouvée`);
            }

            const decodedInstruction = decodeTransaction(parsedTransaction);
            //console.log('decodedInstruction:', decodedInstruction)

            //const decodedInstructions = decodeParsedTransactionInfo(parsedTransaction, 0) as TradeDecodedInstruction[];
            //const decodedInstruction: TradeDecodedInstruction | undefined = decodedInstructions.find(instruction => ['buy', 'sell'].includes(instruction.type)) as TradeDecodedInstruction;

            if (! decodedInstruction) {
                throw new Error(`Intruction décodée non trouvée`);
            }


            const solAmount = decodedInstruction.sol_amount; // / 1e9;
            const tokenAmount = decodedInstruction.token_amount; // / 1e6;

            const txHash = transactionResult.signature ?? 'TX_HASH_MISSING';

            // Enregistrer la vente dans le portfolio
            await this.portfolio.recordSellTransaction(
                token,
                solAmount,
                tokenAmount,
                txHash
            );

            return {
                success: true,
                txHash,
                solAmount,
                tokenAmount: tokenAmountToSell
            };

        } catch (err: any) {
            console.error(`Error selling token ${token.symbol}:`, err);
            return {
                success: false,
                txHash: '',
                solAmount: 0,
                tokenAmount: 0,
                error: err.message
            };

        } finally {
            this.pendingSells--;
        }
    }


    // Vérifier si des conditions de vente automatique sont remplies
    async checkAutoSellConditions(tokens: Token[]): Promise<void> {
        try {
            // Récupérer les recommandations de vente
            const sellRecommendations: SellRecommandation[] = this.portfolio.checkSellConditions();

            for (const recommendation of sellRecommendations) {
                // Récupérer les données du token
                const token = tokens.find(_token => _token.address === recommendation.tokenAddress);

                if (token) {
                    console.log(`AUTO-SELL triggered for ${recommendation.tokenSymbol} - Reason: ${recommendation.reason}`);

                    // Exécuter la vente
                    const result = await this.sellToken(token, recommendation.amount);

                    if (result.success) {
                        console.log(`AUTO-SELL success: Sold ${result.tokenAmount} ${recommendation.tokenSymbol} for ${result.solAmount.toFixed(4)} SOL`);

                    } else {
                        console.error(`AUTO-SELL failed: ${result.error}`);
                    }
                }
            }

        } catch (err: any) {
            console.error('Error checking auto-sell conditions:', err);
        }
    }


    /** Implémentation de la logique d'achat sur pump.fun en utilisant l'API de Solana Web3.js et les instructions spécifiques à pump.fun */
    private async executePumpFunBuy(
        tokenAddress: string,
        solAmount: number,
        slippageBasisPoints = 500
    ): Promise<TransactionResult> {
        const wallet = this.portfolio.getWallet();

        if (!wallet) {
            throw new Error(`Pas de wallet disponible`);
        }

        const mint = new PublicKey(tokenAddress);
        const priorityFees: PriorityFee | undefined = { unitLimit: 100_000, unitPrice: 100_000 };
        const commitment: Commitment | undefined = "confirmed";
        const finality: Finality | undefined = "confirmed";
        //const result: TransactionResult = await pumpFunBuy(this.magicConnection, wallet, mint, BigInt(Math.round(solAmount * 1e9)), BigInt(slippageBasisPoints), priorityFees, commitment, finality);

        const result: TransactionResult = await sendPortalBuyTransaction(this.magicConnection, wallet, tokenAddress, solAmount, slippageBasisPoints/100, 0.00001);

        return result;
    }


    /** Implémentation de la logique de vente sur pump.fun en utilisant l'API de Solana Web3.js et les instructions spécifiques à pump.fun */
    private async executePumpFunSell(
        tokenAddress: string,
        tokenAmount: number,
        slippageBasisPoints = 500
    ): Promise<TransactionResult> {
        const wallet = this.portfolio.getWallet();

        if (!wallet) {
            throw new Error(`Pas de wallet disponible`);
        }

        const mint = new PublicKey(tokenAddress);
        const priorityFees: PriorityFee | undefined = { unitLimit: 250_000, unitPrice: 250_000 };
        const commitment: Commitment | undefined = "confirmed";
        const finality: Finality | undefined = "confirmed";
        //const result: TransactionResult = await pumpFunSell(this.magicConnection, wallet, mint, BigInt(Math.round(tokenAmount * 1e6)), BigInt(slippageBasisPoints), priorityFees, commitment, finality)

        const result: TransactionResult = await sendPortalSellTransaction(this.magicConnection, wallet, tokenAddress, tokenAmount, slippageBasisPoints/100, 0.00001);

        return result;

    }



}


