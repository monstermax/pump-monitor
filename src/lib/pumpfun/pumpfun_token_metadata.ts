// pumpfun_token_metadata.ts

import fetch from 'node-fetch';
import FormData from 'form-data';
import { Commitment, Connection, PublicKey } from "@solana/web3.js";
import { getPdaMetadataKey } from "@raydium-io/raydium-sdk";
import { getMetadataAccountDataSerializer } from "@metaplex-foundation/mpl-token-metadata";


/* ######################################################### */

export type TokenMetadata = {
    name: string,
    symbol: string,
    description: string,
    image: string,
    uri: string,
    website?: string,
    twitter?: string,
    telegram?: string,
    showName: boolean,
    createdOn: string,
}


export type CreateTokenMetadata = {
    file: () => Promise<Blob>;
    name: string;
    symbol: string;
    description: string;
    website?: string;
    twitter?: string;
    telegram?: string;
    showName?: boolean;
};


/* ######################################################### */




export async function createTokenMetadata(create: CreateTokenMetadata) {
    // Validate file
    if (!(create.file instanceof Blob)) {
        throw new Error('File must be a Blob or File object');
    }

    let formData = new FormData();

    const arrayBuffer = await (await create.file()).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    formData.append("file", buffer, {
        filename: 'image.png',
        contentType: 'image/png' // Ajustez selon le type de fichier
    });

    formData.append("name", create.name);
    formData.append("symbol", create.symbol);
    formData.append("description", create.description);
    formData.append("twitter", create.twitter || "");
    formData.append("telegram", create.telegram || "");
    formData.append("website", create.website || "");
    formData.append("showName", "true");

    try {
        const request = await fetch("https://pump.fun/api/ipfs", {
            method: "POST",
            headers: {
                ...formData.getHeaders(),
                'Accept': 'application/json',
            },
            body: formData,
            //credentials: 'same-origin',
        });

        if (request.status === 500) {
            // Try to get more error details
            const errorText = await request.text();
            throw new Error(`Server error (500): ${errorText || 'No error details available'}`);
        }

        if (!request.ok) {
            throw new Error(`HTTP error! status: ${request.status}`);
        }

        const responseText = await request.text();
        if (!responseText) {
            throw new Error('Empty response received from server');
        }

        try {
            const metadataResponseJSON = JSON.parse(responseText);
            return metadataResponseJSON;

        } catch (e) {
            throw new Error(`Invalid JSON response: ${responseText}`);
        }

    } catch (err: any) {
        console.error('Error in createTokenMetadata:', err);
        throw err;
    }
}



export const getTokenMetaData = async (connection: Connection, baseMint: PublicKey, commitment: Commitment): Promise<TokenMetadata | null> => {
    try {
        const serializer = getMetadataAccountDataSerializer();
        const metadataPDA = getPdaMetadataKey(baseMint);

        const metadataAccount = await connection.getAccountInfo(
            metadataPDA.publicKey,
            commitment
        );

        if (!metadataAccount?.data) {
            return null;
        }

        const deserialize = serializer.deserialize(metadataAccount.data);
        // console.log("deserialize:", deserialize)
        const metaData = await (await fetch(deserialize[0].uri)).json();

        return {
            ...metaData,
            uri: deserialize[0].uri,
        };

    } catch (err: any) {
        return null;
    }
}


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

