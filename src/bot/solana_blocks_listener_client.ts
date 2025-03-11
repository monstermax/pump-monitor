// solana_fast_listener_client.ts

import WebSocket from 'ws';
import type { FastListenerCreateTokenInput, FastListenerMessage, FastListenerTradeInput } from './bot_types';

import { log, warn } from '../lib/utils/console';
import { SendTransactionError, VersionedTransactionResponse } from '@solana/web3.js';
import { PumpTokenInfo, TradeInfo } from '../lib/pumpfun/pumpfun_tx_decoder';


/* ######################################################### */


export const blocksListenerMints = new Map<string, PumpTokenInfo>;
export const blocksListenerTrades = new Map<string, TradeInfo>;


/* ######################################################### */


/** Traite un message recu (created / buy / sell / balance_update) sur le websocket Solana RPC */
export function handleSolanaPumpTransactionMessage(data: PumpTokenInfo | TradeInfo | SendTransactionError | null) {

    if (!data) {
        // transaction non parsée (instruction non trouvée OU decodage de l'instruction non implémenté)

    } else if ('tokenName' in data) {
        // Mint

        if (!blocksListenerMints.has(data.signature)) {
            blocksListenerMints.set(data.signature, data);
            log(`==> SET MINT TX for token ${data.tokenAddress}`);
        }

    } else if ('tradeType' in data) {
        // Trade

        if (!blocksListenerTrades.has(data.signature)) {
            blocksListenerTrades.set(data.signature, data);
            log(`==> SET MINT TX for token ${data.tokenAddress}`);
        }

    }


}


