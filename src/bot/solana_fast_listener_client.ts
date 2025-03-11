// solana_fast_listener_client.ts

import WebSocket from 'ws';
import type { FastListenerCreateTokenInput, FastListenerMessage, FastListenerTradeInput } from './bot_types';

import { log, warn } from '../lib/utils/console';


/* ######################################################### */


export const fastListenerMints = new Map<string, FastListenerCreateTokenInput>;
export const fastListenerTrades = new Map<string, FastListenerTradeInput>;


/* ######################################################### */


/** Traite un message recu (created / buy / sell / balance_update) sur le websocket Solana Fast Listener */
export function handleFastListenerPumpTransactionMessage(ws: WebSocket | null, data: WebSocket.Data) {
    if (!ws) return;

    let messages: FastListenerMessage[] = [];

    try {
        messages = JSON.parse(data.toString());

    } catch (err: any) {
        warn(`❌ Erreur de décodage du message ${data.toString()}`);
        return;
    }

    for (const message of messages) {
        if (message.type === 'created') {
            log(`[FST] Received CREATE  transaction for token ${message.accounts.mint}`)
            handleFastListenerCreateTokenMessage(ws, message as FastListenerCreateTokenInput);
        }

        if (message.type === 'buy') {
            //log(`Received BUY     transaction for token ${message.accounts.mint}`)
            handleFastListenerTradeTokenMessage(ws, message as FastListenerTradeInput);
        }

        if (message.type === 'sell') {
            //log(`Received SELL   transaction for token ${message.accounts.mint}`)
            handleFastListenerTradeTokenMessage(ws, message as FastListenerTradeInput);
        }
    }
}




export function handleFastListenerCreateTokenMessage(ws: WebSocket, mintInput: FastListenerCreateTokenInput) {
    //log('FL/mintInput:', mintInput);

    if (!fastListenerMints.has(mintInput.hash)) {
        fastListenerMints.set(mintInput.hash, mintInput);
        log(`==> SET MINT TX for token ${mintInput.accounts.mint}`);
    }
}


export function handleFastListenerTradeTokenMessage(ws: WebSocket, tradeInput: FastListenerTradeInput) {
    //log('FL/tradeInput:', tradeInput);

    if (!fastListenerTrades.has(tradeInput.hash)) {
        fastListenerTrades.set(tradeInput.hash, tradeInput);
    }
}


