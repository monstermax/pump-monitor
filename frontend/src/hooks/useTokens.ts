// useTokens.ts

import axios from "axios";
import { useEffect, useState } from "react";

import { TokenData } from "../backend-models/token";
import { endpoint } from "../config";



export function useTokens() {
    const [tokens, setTokens] = useState<TokenData[]>([]);

    useEffect(() => {
        axios.get<TokenData[]>(`${endpoint}/api/tokens`)
            .then(response => setTokens(response.data))
            .catch(err => console.error("Erreur lors de la récupération des tokens", err));
    }, []);

    return tokens;
}
