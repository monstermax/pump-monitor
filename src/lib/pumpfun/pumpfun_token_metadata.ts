// pumpfun_token_metadata.ts

import fetch from 'node-fetch';

/* ######################################################### */



export async function fetchTokenInfos(tokenAddress: string, timeout = 1000, retries = 3, retryDelay = 500) {
    const url = `https://frontend-api-v3.pump.fun/coins/${tokenAddress}`;
    //console.log(`Fetching ${url} ...`);

    // TODO: retirer la recusrivité et retourner une promise

    return fetch(url, { timeout })
        .then(response => {
            if (response.status !== 200) throw new Error(`Code HTTP ${response.status} invalide`);
            return response.json();
        })
        .then(tokenData => {
            //console.log('tokenData:', tokenData);
            //const age = Date.now() - tokenData.created_timestamp;
            //console.log(`Age: ${age} ms`);
            return tokenData;
        })
        .catch((err: any) => {
            // Page API pas encore disponible

            //return 0; // considérer un age de 0 seconde

            if (retries <= 0) {
                throw err;
            }

            console.warn(`Echec du fetch. Nouvel essai dans ${retryDelay} ms`);
            setTimeout(() => fetchTokenInfos(tokenAddress, timeout, retries - 1), retryDelay);
        })

}



