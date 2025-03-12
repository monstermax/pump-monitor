// PumpFunIndexer.service.ts

import WebSocket from "ws";
import { SendTransactionError, VersionedTransactionResponse } from "@solana/web3.js";

import { appConfig } from "../../env";
import { error, log } from "../../lib/utils/console";
import { WebsocketHandlers, WsConnection } from "../../lib/utils/websocket";

import { PumpTokenInfo, TradeInfo, TransactionDecoder } from "../../lib/pumpfun/pumpfun_tx_decoder";
import { ServiceAbstract } from "./abstract.service";
import { BlockNotification } from "../../pump_indexer";
import { CreateTokenTxResult, TokenTradeTxResult } from "./PumpListener.service";
import { PUMPFUN_PROGRAM_ID } from "../../lib/pumpfun/pumpfun_config";
import { buidVersionedMessageFromResponse } from "../../lib/pumpfun/pumpfun_tx_tools";


/* ######################################################### */


export class PumpFunIndexer extends ServiceAbstract {
    private connectionName = "Solana RPC WebSocket";
    private rpcUrl = appConfig.solana.rpc.chainstack;
    private wsSolana: ReturnType<typeof WsConnection> | null = null;
    private transactions = new Map<string, VersionedTransactionResponse>;
    private mints = new Set<string>;


    start() {
        const wsHandlers: WebsocketHandlers = {
            onconnect: (ws: WebSocket) => this.subscribePumpBlocks(ws),
            onmessage: (ws: WebSocket, data: WebSocket.Data) => this.handleSolanaPumpTransactionMessage(ws, data),
            onclose: (ws: WebSocket) => this.log(`⚠️ WebSocket ${this.connectionName} closed`),
            onerror: (ws: WebSocket, err: Error) => this.error(`❌ WebSocket ${this.connectionName} error: ${err.message}`),
            onreconnect: () => this.log(`📢 Tentative de reconnexion du websocket ${this.connectionName} ...`),
        }

        this.wsSolana = WsConnection(this.rpcUrl, wsHandlers);
        this.wsSolana.connect();
    }


    stop() {
        if (! this.wsSolana) return;
        this.wsSolana?.close();
    }


    subscribePumpBlocks(ws: WebSocket) {
        this.log('subscribing pump blocks');

        ws.send(
            JSON.stringify(
                {
                    "jsonrpc": "2.0",
                    "id": "1",
                    "method": "blockSubscribe",
                    "params": [
                        {
                            "mentionsAccountOrProgram": PUMPFUN_PROGRAM_ID
                        },
                        {
                            "commitment": "confirmed",
                            "encoding": "jsonParsed",
                            "showRewards": false,
                            "transactionDetails": "full",
                            "maxSupportedTransactionVersion": 0
                        }
                    ]
                }
            )
        )
    }


    handleSolanaPumpTransactionMessage(ws: WebSocket, msg: WebSocket.Data) {
        const data: BlockNotification = JSON.parse(msg.toString())

        if ('id' in data) return; // confirmation de souscription => { jsonrpc: '2.0', result: 71519, id: '1' }

        const { jsonrpc, method, params } = data;

        if (method === 'blockNotification') {
            const decoder = new TransactionDecoder;
            const { block, slot } = params.result.value;
            const { transactions, blockTime, blockHeight } = block;


            const transactionsFormatted: VersionedTransactionResponse[] = transactions.map(txData => {
                const txResponse: VersionedTransactionResponse = {
                    ...txData,
                    transaction: {
                        ...txData.transaction,
                        message: buidVersionedMessageFromResponse(txData.version ?? 'legacy', txData.transaction.message as any)
                    },
                    slot,
                    blockTime,
                } as VersionedTransactionResponse;

                return txResponse;
            });


            if (true) {
                const tsStart = Date.now();

                transactions.forEach(txData => {
                    const txResponse: VersionedTransactionResponse = {
                        ...txData,
                        transaction: {
                            ...txData.transaction,
                            message: buidVersionedMessageFromResponse(txData.version ?? 'legacy', txData.transaction.message as any)
                        },
                        slot,
                        blockTime,
                    } as VersionedTransactionResponse;

                    const result: PumpTokenInfo | TradeInfo | SendTransactionError | null = decoder.parsePumpTransactionResponse(txResponse);


                    if (result) {
                        if ('tokenName' in result) {
                            // Mint

                            this.mints.add(result.tokenAddress);

                            const newTokenData = convertResultToToken(result);

                            const initialBuy = result.initialBuy ? convertResultToTrade(result.initialBuy) : undefined;

                            this.emit('create', newTokenData, initialBuy);

                        } else if ('tradeType' in result) {
                            // Trade
                            const tradeTokenData = convertResultToTrade(result);

                            if (this.mints.has(result.tokenAddress)) {
                                this.emit('trade', tradeTokenData);
                            }
                        }
                    }
                });

                const duration = Date.now() - tsStart;

                //this.log(`Block ${blockHeight} decoded => ${transactions.length} pumpfun transactions found (in ${duration} ms)`)
            }


            if (false) {
                transactionsFormatted.forEach(tx => {
                    this.emit('pump_transaction', tx);
                    this.transactions.set(tx.transaction.signatures[0], tx);
                });
            }

        }
    }

}



function convertResultToToken(result: PumpTokenInfo): CreateTokenTxResult {
    const newTokenData: CreateTokenTxResult  = {
        txType: 'create',
        signature: result.signature,
        instructionIdx: result.instructionIdx,
        mint: result.tokenAddress,
        traderPublicKey: result.creatorAddress,
        bondingCurveKey: result.bondingCurveAddress,
        vTokensInBondingCurve: result.virtualTokenReserves ?? 0,
        vSolInBondingCurve: result.virtualSolReserves ?? 0,
        price: ((result.virtualSolReserves ?? 0) / (result.virtualTokenReserves ?? 0)).toFixed(10),
        marketCapSol: result.marketCapSol ?? 0,
        totalSupply: Number(result.totalSupply),
        name: result.tokenName ?? '',
        symbol: result.tokenSymbol ?? '',
        uri: result.metadataUri ?? '',
        image: '', // fetch uri to get metadata
        website: '', // fetch uri to get metadata
        twitter: '', // fetch uri to get metadata
        telegram: '', // fetch uri to get metadata
        createdAt: result.createdAt,
        updatedAt: null,
        dataSource: 'PumpFunIndexer',
    };

    return newTokenData;
}


function convertResultToTrade(result: TradeInfo): TokenTradeTxResult {
    const tradeTokenData: TokenTradeTxResult = {
        txType: result.tradeType,
        signature: result.signature,
        instructionIdx: result.instructionIdx,
        mint: result.tokenAddress,
        traderPublicKey: result.traderAddress,
        tokenAmount: result.tokenAmount,
        solAmount: result.solAmount,
        tokenPostBalance: result.traderPostBalanceToken,
        bondingCurveKey: result.bondingCurveAddress,
        vTokensInBondingCurve: result.virtualTokenReserves,
        vSolInBondingCurve: result.virtualSolReserves,
        price: (result.virtualSolReserves / result.virtualTokenReserves).toFixed(10),
        marketCapSol: result.marketCapSol,
        timestamp: result.timestamp,
        dataSource: 'PumpFunIndexer',
    };

    return tradeTokenData;
}