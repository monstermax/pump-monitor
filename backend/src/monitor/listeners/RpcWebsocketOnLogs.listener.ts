// RpcWebsocketOnLogs.listener.ts

import { Connection, ParsedTransactionWithMeta, PublicKey, SendTransactionError } from "@solana/web3.js";
import EventEmitter from "events";

import { appConfig } from "../../env";
import { PUMPFUN_PROGRAM_ID } from "../../lib/pumpfun/pumpfun_config";
import { getBondingCurveAccount } from "../../lib/pumpfun/pumpfun_bondingcurve_account";
import { getTokenMetaData, TokenMetadata } from "../../lib/pumpfun/pumpfun_token_metadata";
import { PumpTokenInfo, TradeInfo, TransactionDecoder } from "../../lib/pumpfun/pumpfun_tx_decoder";
import { convertToVersionedTransactionResponse } from "../../lib/pumpfun/pumpfun_tx_tools";
import { CreateTokenTxResult, TokenTradeTxResult } from "../services/PumpListener.service";


/* ######################################################### */


// Code non fonctionnel. L'ecoute des trades requiert de faire trop de calls rpc (getParsedTransaction)


const decoder = new TransactionDecoder;

type CreateTokenAdditionalData = any;
type NewTokenDecodedInstruction = any;
type TradeDecodedInstruction = any;



export class RpcWebsocketOnLogs extends EventEmitter {
    private connection: Connection;

    constructor() {
        super();
        this.connection = new Connection(appConfig.solana.rpc.helius, { wsEndpoint: appConfig.solana.websocket, commitment: "confirmed" });
    }


    start() {
        console.log('✔️ Connected to Solana RPC/WebSocket (RpcWebsocketOnLogs)');

        this.connection.onLogs(new PublicKey(PUMPFUN_PROGRAM_ID), this.handleLogs.bind(this));
    }


    async handleLogs(result: any): Promise<void> {
        const { logs, err, signature } = result as { logs: string[], err: any, signature: string };

        const hasMint = logs.filter(log => log.includes("MintTo")).length;

        //console.log('isMint:', isMint)
        //console.log('logs:', logs)
        //if(1) process.exit();


        if (hasMint) {
            console.log("============== Found new token in the pump.fun: ==============")
            console.log("signature: ", signature);

            const parsedTransaction: ParsedTransactionWithMeta | null = await this.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });

            if (!parsedTransaction) {
                console.log("bad Transaction, signature: ", signature);
                return;
            }

            //console.log('parsedTransaction:', parsedTransaction)

            //const wallet = parsedTransaction?.transaction.message.accountKeys[0].pubkey;
            //const mint = parsedTransaction?.transaction.message.accountKeys[1].pubkey;
            //const tokenPoolAta = parsedTransaction?.transaction.message.accountKeys[4].pubkey;

            //console.log('- trader:', wallet.toBase58())
            //console.log('- mint:', mint.toBase58())
            //console.log('- tokenPoolAta:', tokenPoolAta.toBase58())


            const decodedInstruction = decoder.parsePumpTransactionResponse(convertToVersionedTransactionResponse(parsedTransaction)) as PumpTokenInfo | TradeInfo | SendTransactionError | null;


            if (decodedInstruction) {

                if ('txType' in decodedInstruction && decodedInstruction.txType === 'create' && 'tokenName' in decodedInstruction) {

                    const bondingAccount = await getBondingCurveAccount(this.connection, new PublicKey(decodedInstruction.bondingCurveAddress), 'processed')
                    const marketCapSol = bondingAccount?.getMarketCapSOL();

                    const tokenMetadata: TokenMetadata | null = await getTokenMetaData(this.connection, new PublicKey(decodedInstruction.tokenAddress), 'processed')
                    //console.log('tokenMetadata:', tokenMetadata)

                    const additionalData: CreateTokenAdditionalData = {
                        vTokensInBondingCurve: bondingAccount?.virtualTokenReserves ? Number(bondingAccount.virtualTokenReserves) / 1e6 : undefined,
                        vSolInBondingCurve: bondingAccount?.virtualSolReserves ? Number(bondingAccount.virtualSolReserves) / 1e9 : undefined,
                        marketCapSol: marketCapSol ? Number(marketCapSol) / 1e9 : undefined,
                        totalSupply: bondingAccount?.tokenTotalSupply ? Number(bondingAccount?.tokenTotalSupply) / 1e6 : 0,
                        name: tokenMetadata?.name,
                        symbol: tokenMetadata?.symbol,
                        image: tokenMetadata?.image,
                        uri: tokenMetadata?.uri,
                        website: tokenMetadata?.website,
                        twitter: tokenMetadata?.twitter,
                        telegram: tokenMetadata?.telegram,
                    };

                    // intruction token created
                    const messageFormatted: CreateTokenTxResult = transformCreateTokenObject(parsedTransaction, decodedInstruction, additionalData);
                    //messageFormatted.signature = signature;
                    console.log('messageFormatted:', messageFormatted)

                    this.emit('create', messageFormatted);
                }

            } else {
                console.warn(`decodedInstruction:`, decodedInstruction);
                console.warn(`WARNING: decodage d'instruction impossible.`);
            }

            // TODO: subscribe aux logs du token ou de la bonding curve


        } else {

            // NOTE: requiert trop de call RPC (getParsedTransaction) => a revoir ou prévoir une methode alternative

            if (1) return;


            console.log("============== Found trade in the pump.fun: ==============")
            console.log("signature: ", signature);

            const parsedTransaction: ParsedTransactionWithMeta | null = await this.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });

            if (!parsedTransaction) {
                console.log("bad Transaction, signature: ", signature);
                return;
            }

            const decodedInstruction = decoder.parsePumpTransactionResponse(convertToVersionedTransactionResponse(parsedTransaction)) as PumpTokenInfo | TradeInfo | SendTransactionError | null;
            //console.log('decodedInfo:', decodedInstructions);
            //console.log('accounts:', decodedInstructions);

            if (decodedInstruction && 'txType' in decodedInstruction && (decodedInstruction.txType === 'buy' || decodedInstruction.txType === 'sell')) {
                const messageFormatted: TokenTradeTxResult = transformTradeObject(parsedTransaction, decodedInstruction);
                console.log('messageFormatted:', messageFormatted)

            } else {
                console.warn(`decodedInstruction:`, decodedInstruction);
                console.warn(`WARNING: decodage d'instruction impossible.`);
            }

        }
    }

}






export function transformCreateTokenObject(tx: ParsedTransactionWithMeta, instruction: NewTokenDecodedInstruction, additionalData?: any): CreateTokenTxResult {

    return {
        txType: 'create',
        mint: instruction.accounts.mint,
        name: additionalData?.name || '',
        symbol: additionalData?.symbol || '',
        traderPublicKey: instruction.accounts.user,
        bondingCurveKey: instruction.accounts.bonding_curve,
        vTokensInBondingCurve: additionalData?.vTokensInBondingCurve || 0,
        vSolInBondingCurve: additionalData?.vSolInBondingCurve || 0,
        marketCapSol: additionalData?.marketCapSol || 0,
        totalSupply: additionalData?.totalSupply || 0,
        uri: additionalData?.uri || '',
        image: additionalData?.image || '',
        website: additionalData?.website || '',
        twitter: additionalData?.twitter || '',
        telegram: additionalData?.telegram || '',
        signature: instruction.hash,
        instructionIdx: 0,
        price: (instruction.virtual_sol_reserves / instruction.virtual_token_reserves).toFixed(10),
        createdAt: new Date,
        updatedAt: new Date,
        dataSource: 'RpcWebsocketOnLogs',
    };
}



export function transformTradeObject(tx: ParsedTransactionWithMeta, instruction: TradeDecodedInstruction): TokenTradeTxResult {
    // Calcul de la market cap en SOL
    let marketCapSol = 0;

    // Si token_amount ou sol_amount sont nuls ou très proches de zéro
    if (!instruction.token_amount || !instruction.sol_amount ||
        instruction.token_amount < 0.00000001 || instruction.sol_amount < 0.00000001) {

        // Utiliser directement les réserves virtuelles pour calculer le prix et la market cap
        if (instruction.virtual_token_reserves && instruction.virtual_sol_reserves) {
            const virtualPrice = instruction.virtual_sol_reserves / instruction.virtual_token_reserves;
            marketCapSol = virtualPrice * instruction.virtual_token_reserves;
        }

    } else {
        // Calcul normal du prix et de la market cap
        const price = instruction.sol_amount / instruction.token_amount;
        marketCapSol = price * instruction.virtual_token_reserves;
    }

    // Vérification supplémentaire pour éviter des valeurs aberrantes
    if (!isFinite(marketCapSol) || isNaN(marketCapSol)) {
        console.warn(`Calcul de marketCap problématique pour le trade ${instruction.hash}. Utilisation des réserves virtuelles.`);
        // Fallback en utilisant directement les réserves virtuelles
        marketCapSol = instruction.virtual_sol_reserves;
    }

    return {
        signature: instruction.hash,
        mint: instruction.accounts.mint,
        traderPublicKey: instruction.user,
        txType: instruction.type === 'sell' ? 'sell' : 'buy',
        tokenAmount: instruction.token_amount,
        solAmount: instruction.sol_amount,
        //newTokenBalance: 0,
        bondingCurveKey: instruction.accounts.bonding_curve,
        vTokensInBondingCurve: instruction.virtual_token_reserves,
        vSolInBondingCurve: instruction.virtual_sol_reserves,
        marketCapSol,
        instructionIdx: 0,
        price: (instruction.virtual_sol_reserves / instruction.virtual_token_reserves).toFixed(10),
        timestamp: new Date,
        dataSource: 'RpcWebsocketOnLogs',
    };
}



if (require.main === module) {
    const client = new RpcWebsocketOnLogs();

    client.start();

}
