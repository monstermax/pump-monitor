// websocket_subscriptions.ts

import WebSocket from 'ws';

import * as pumpWsApi from '../lib/pumpfun/pumpfun_websocket_api';
import { log } from '../lib/utils/console';


/* ######################################################### */

// Souscriptions


export class PumpfunWebsocketApiSubscriptions {
    ws: WebSocket;

    constructor(ws: WebSocket) {
        this.ws = ws;
    }


    subscribeNewTokens() {
        pumpWsApi.subscribeNewToken(this.ws);
        log(`🔔 Inscrit aux nouveaux tokens`);
    }


    unsubscribeNewTokens() {
        pumpWsApi.unsubscribeNewToken(this.ws);
        log(`🛎️ Désinscrit des nouveaux tokens`);
    }


    subscribeToTokens(tokenAddresses: string[]) {
        pumpWsApi.subscribeTokenTrade(this.ws, tokenAddresses);
        log(`🔔 Inscrit aux tokens ${tokenAddresses.join(' | ')}`);
    }


    unsubscribeToTokens(tokenAddresses: string[]) {
        pumpWsApi.unsubscribeTokenTrade(this.ws, tokenAddresses);
        log(`🛎️ Désinscrit des tokens ${tokenAddresses.join(' | ')}`);
    }

}



