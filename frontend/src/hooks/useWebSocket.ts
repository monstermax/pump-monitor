// useWebSocket.ts

import { useEffect, useState } from "react";


export interface DataEvent {
    id: string;
    type: string;
    price: number;
    holders: number;
    // Ajoute d'autres champs si nécessaire
}


export function useWebSocket(url: string) {
    const [data, setData] = useState<DataEvent[]>([]);

    useEffect(() => {
        const ws = new WebSocket(url);

        ws.onmessage = (event) => {
            try {
                const parsed: DataEvent = JSON.parse(event.data);
                setData(prev => [parsed, ...prev]); // Ajoute l'élément au début

            } catch (error) {
                console.error("Erreur lors du parsing de la data :", error);
            }
        };

        ws.onerror = (error) => {
            console.error("Erreur WebSocket :", error);
        };

        return () => {
            ws.close();
        };
    }, [url]);

    return data;
}

