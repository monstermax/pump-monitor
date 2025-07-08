// useTraders.ts

import axios from "axios";
import { useEffect, useState } from "react";

import { Trader } from "../backend-models/trader";


export function useTraders() {
    const [traders, setTraders] = useState<Trader[]>([]);

    useEffect(() => {
        axios.get<Trader[]>("/api/tokens")
            .then(response => setTraders(response.data))
            .catch(err => console.error("Erreur lors de la récupération des traders", err));
    }, []);

    return traders;
}
