// websocket.ts

import WebSocket from 'ws';


export type WebsocketConnectHandler = (ws: WebSocket) => void;
export type WebsocketCloseHandler = (ws: WebSocket) => void;
export type WebsocketErrorHandler = (ws: WebSocket, err: Error) => void;
export type WebsocketReconnectHandler = () => void;
export type WebsocketMessageHandler = (ws: WebSocket, data: WebSocket.Data) => void;

export type WebsocketHandlers = {
    onconnect?: WebsocketConnectHandler;
    onclose?: WebsocketCloseHandler;
    onerror?: WebsocketErrorHandler;
    onreconnect?: WebsocketReconnectHandler;
    onmessage?: WebsocketMessageHandler;
}



export const WsConnection = function (wsUrl: string, handlers?: WebsocketHandlers, options?: { reconnectDelay?: number }) {
    let pingIntervalId: NodeJS.Timeout | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isConnected: boolean = false;
    let ws: WebSocket | null = null;
    let pingInterval: number = 15_000;


    function connect() {
        return new Promise<WebSocket | null>((resolve, reject) => {
            if (ws) {
                ws.removeAllListeners();
                ws.close();
            }

            ws = new WebSocket(wsUrl);

            ws.on('open', () => {
                isConnected = true;
                setupPing();

                if (reconnectTimeout) {
                    clearTimeout(reconnectTimeout);
                    reconnectTimeout = null;
                }

                if (ws && handlers?.onconnect) {
                    handlers.onconnect(ws);
                }

                resolve(ws);
            });


            // Gestion des evenements websocket
            ws.on('message', (data) => ws && handlers?.onmessage ? handlers.onmessage(ws, data) : void(0));

            ws.on('close', handleClose);
            ws.on('error', handleError);
        })

    }


    function setupPing() {
        if (pingIntervalId) {
            clearInterval(pingIntervalId);
        }

        pingIntervalId = setInterval(() => {
            if (ws && isConnected) {
                ws.ping();
            }
        }, pingInterval);
    }


    /** Gère la fermeture annoncée de la connexion websocket */
    function handleClose() {
        cleanup();
        scheduleReconnect();

        if (ws && handlers?.onclose) {
            handlers.onclose(ws);
        }
    }


    /** Gère les erreurs survenues sur la connexion websocket */
    function handleError(err: Error) {
        cleanup();
        scheduleReconnect();

        if (ws && handlers?.onerror) {
            handlers.onerror(ws, err);
        }
    }


    /** Nettoyage des timeouts/intervals après déconnexion */
    function cleanup() {
        isConnected = false;

        if (pingIntervalId) {
            clearInterval(pingIntervalId);
            pingIntervalId = null;
        }
    }


    /** Programme une reconnexion au websocket dans 5 secondes */
    function scheduleReconnect() {
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(() => {

                if (handlers?.onreconnect) {
                    handlers.onreconnect();
                }

                connect();
            }, options?.reconnectDelay ?? 5_000); // Reconnexion après 5 secondes
        }
    }


    /** Ferme la connexion au websocket */
    function close() {
        cleanup();

        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }

        if (ws) {
            ws.close();
            ws = null;
        }
    }

    return {
        ws,
        connect,
        isConnected: () => isConnected,
        close,
    };
}

