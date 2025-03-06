// pumpfun_websocket_api.ts

import WebSocket from 'ws';

/* ######################################################### */


export type WsMessagePayload = {
    method: string,
    keys?: string[],
}


export function getPumpPortalWebsocket(): WebSocket {
    const ws = new WebSocket('wss://pumpportal.fun/api/data');
    return ws;
}


export function subscribeNewToken(ws: WebSocket) {
    // Subscribing to token creation events
    let payload: WsMessagePayload = {
        method: "subscribeNewToken",
    }

    ws.send(JSON.stringify(payload)); // result => SubscribeResult + CreateTokenResult
}

export function unsubscribeNewToken(ws: WebSocket) {
    let payload: WsMessagePayload = {
        method: "unsubscribeNewToken",
    }

    ws.send(JSON.stringify(payload)); // result => UnsubscribeResult
}


export function subscribeAccountTrade(ws: WebSocket, keys: string[]) {
    let payload: WsMessagePayload = {
        method: "subscribeAccountTrade",
        keys,
        //keys: ["AArPXm8JatJiuyEffuC1un2Sc835SULa4uQqDcaGpAjV"] // array of accounts to watch
    };

    ws.send(JSON.stringify(payload)); // result => SubscribeResult + TokenTradeResult
}

export function unsubscribeAccountTrade(ws: WebSocket, keys: string[]) {
    let payload: WsMessagePayload = {
        method: "unsubscribeAccountTrade",
        keys,
        //keys: ["AArPXm8JatJiuyEffuC1un2Sc835SULa4uQqDcaGpAjV"] // array of accounts to watch
    };

    ws.send(JSON.stringify(payload)); // result => UnsubscribeResult
}


export function subscribeTokenTrade(ws: WebSocket, keys: string[]) {
    let payload: WsMessagePayload = {
        method: "subscribeTokenTrade",
        keys,
        //keys: ["91WNez8D22NwBssQbkzjy4s2ipFrzpmn5hfvWVe2aY5p"] // array of token CAs to watch
    };

    ws.send(JSON.stringify(payload)); // result => SubscribeResult + TokenTradeResult
}

export function unsubscribeTokenTrade(ws: WebSocket, keys: string[]) {
    let payload: WsMessagePayload = {
        method: "unsubscribeTokenTrade",
        keys,
        //keys: ["91WNez8D22NwBssQbkzjy4s2ipFrzpmn5hfvWVe2aY5p"] // array of token CAs to watch
    };

    ws.send(JSON.stringify(payload)); // result => UnsubscribeResult
}


export function subscribeRaydiumLiquidity(ws: WebSocket) {
    let payload: WsMessagePayload = {
        method: "subscribeRaydiumLiquidity",
    };

    ws.send(JSON.stringify(payload)); // result => SubscribeResult + RaydiumLiquidityResult
}


export function unsubscribeRaydiumLiquidity(ws: WebSocket) {
    throw new Error(`method unsubscribeRaydiumLiquidity not supported`);

    let payload: WsMessagePayload = {
        method: "unsubscribeRaydiumLiquidity",
    };

    ws.send(JSON.stringify(payload)); // result => UnsubscribeResult
}

