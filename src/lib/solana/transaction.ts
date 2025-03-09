import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { TransactionResult } from "../../services/Trading.service";


/* ######################################################### */


export async function sendSolanaTransaction(connection: Connection, wallet: Keypair, tx: VersionedTransaction, options?: { skipPreflight: false }) {
    let success = false;
    let error = undefined;

    tx.sign([wallet]);

    // Envoi de la transaction
    const signature = await connection.sendTransaction(tx, {
            skipPreflight: options?.skipPreflight ?? false,
            maxRetries: 3, // Autoriser des retries au niveau de l'API
            preflightCommitment: 'confirmed',
        })
        .then((result) => {
            success = true;
            return result;
        })
        .catch((err: any) => {
            error = err;
            //console.warn(`sendPortalTransaction error. ${err.message}`);
            return undefined;
        })

    //console.log("Transaction: https://solscan.io/tx/" + signature);

    const result: TransactionResult = {
        success,
        signature,
        error,
    };

    return result;
}


