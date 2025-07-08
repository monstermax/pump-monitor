// contexts/SocketContext.tsx

import React, { createContext, ReactNode, useEffect, useState } from 'react';
import io from 'socket.io-client';


const wsUrl = import.meta.env.VITE_WS_URL;


// Créer le contexte
export const SocketContext = createContext<SocketIOClient.Socket | null>(null);


interface SocketProviderProps {
    children: ReactNode;
}


export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
    const [socket, setSocket] = useState<SocketIOClient.Socket | null>(null);

    useEffect(() => {
        console.log("Connecting to Socket.IO server...");
        const newSocket = io(wsUrl);

        newSocket.on('connect', () => {
            console.log("Connected to Socket.IO server");
            // Demander les données initiales après connexion
            newSocket.emit('get_initial_data');
        });

        newSocket.on('connect_error', (error: any) => {
            console.error("Socket.IO connection error:", error);
        });

        setSocket(newSocket);

        return () => {
            console.log("Disconnecting from Socket.IO server");
            newSocket.disconnect();
        };
    }, []);

    return (
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    );
};
