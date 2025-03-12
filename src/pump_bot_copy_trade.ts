// pump_bot_copy_trade.ts

import { Connection } from "@solana/web3.js";

import { appConfig } from "./env";
import { getTokenHolders } from "./lib/pumpfun/pumpfun_token_holders";


async function main() {
    const connection = new Connection(appConfig.solana.rpc.helius);

    const holders = await getTokenHolders(connection, 'DCSLeg5dC7LcrixNu1heMv1ft6csYAMkdqEpRpbEpump')

    console.log('holders:', holders)
}


main();
