// pumpfun_token_holders.ts

import { AccountInfo, Connection, ParsedAccountData, PublicKey } from "@solana/web3.js";
import { PUMPFUN_TOKEN_PROGRAM_ID } from "./pumpfun_config";


/* ######################################################### */


export async function getTokenHolders(connection: Connection, tokenAddress: string) {
    const mintPublicKey = new PublicKey(tokenAddress)

    const tokenAccounts = await connection.getParsedProgramAccounts(
        new PublicKey(PUMPFUN_TOKEN_PROGRAM_ID),
        {
            filters: [
                {
                    dataSize: 165, // taille SPL Tokens (165 octets)
                },
                {
                    memcmp: {
                        offset: 0,
                        bytes: mintPublicKey.toBase58(),
                    },
                }
            ],
        },
    );


    const holders: Map<string, { amount: number, percentage: number }> = new Map; // stocke la balance
    let totalSupply = 0;

    for (const account of tokenAccounts) {
        const accountAccount = account.account as AccountInfo<ParsedAccountData>;
        const parsedData = accountAccount.data.parsed.info;

        const balance = parsedData.tokenAmount.uiAmount;

        if (balance > 0) {
            holders.set(parsedData.owner, { amount: balance, percentage: 0 });
            totalSupply += balance;
        }
    }

    holders.forEach(holder => holder.percentage = 100 * holder.amount / totalSupply);


    const sortedHolders = Object.fromEntries(
        [...holders.entries()]
            .sort((a, b) => {
                return b[1].percentage - a[1].percentage
            })
    );

    return sortedHolders;
}

