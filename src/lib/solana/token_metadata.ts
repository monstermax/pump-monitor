// token_metadata.ts

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


/* ######################################################### */


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


