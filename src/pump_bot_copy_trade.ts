// pump_bot_copy_trade.ts

import { Connection, Keypair } from "@solana/web3.js";

import { appConfig } from "./env";
import { getTokenHolders } from "./lib/pumpfun/pumpfun_token_holders";
import { getEmptyTokenAccounts } from "./lib/solana/solana_token_cleanup";
import base58 from "bs58";


async function main() {
    const connection = new Connection(appConfig.solana.rpc.helius);

    //const holders = await getTokenHolders(connection, 'DCSLeg5dC7LcrixNu1heMv1ft6csYAMkdqEpRpbEpump')
    //console.log('holders:', holders)


    const wallet = Keypair.fromSecretKey(base58.decode(appConfig.solana.WalletPrivateKey));
    const accounts = await getEmptyTokenAccounts(connection, wallet.publicKey);
    console.log('accounts:', accounts.map(account => account.mint.toBase58()))
}


main();
