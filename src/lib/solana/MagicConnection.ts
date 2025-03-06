// MagicConnection.ts

import { AccountInfo, Commitment, Connection, ConnectionConfig, Finality, GetAccountInfoConfig, GetBalanceConfig, GetVersionedTransactionConfig, Message, ParsedAccountData, ParsedTransactionWithMeta, PublicKey, RpcResponseAndContext, SendOptions, Signer, SimulatedTransactionResponse, SimulateTransactionConfig, TokenAccountsFilter, Transaction, TransactionSignature, VersionedTransaction } from "@solana/web3.js";

import { appConfig } from "../../env";
import { sleep } from "../utils/time.util";


export type MagicConnectionOptions = {
    rpcs: string[],
    maxRetries?: number,
    timeout?: number,
};



export class MagicConnection extends Connection {
    private proxyOptions: MagicConnectionOptions;

    constructor(proxyOptions: MagicConnectionOptions, commitmentOrConfig?: Commitment | ConnectionConfig) {
        super(proxyOptions.rpcs[0], commitmentOrConfig);
        this.proxyOptions = proxyOptions;
    }

    getParsedTransaction(signature: TransactionSignature, commitmentOrConfig?: GetVersionedTransactionConfig | Finality): Promise<ParsedTransactionWithMeta | null> {
        const promise = async (connection: Connection) => {
            return connection.getParsedTransaction(signature, commitmentOrConfig);
        };

        return MagicConnectionMethod(promise, this.proxyOptions.rpcs, this.proxyOptions.maxRetries, this.proxyOptions.timeout);
    }

    getBalance(publicKey: PublicKey, commitmentOrConfig?: Commitment | GetBalanceConfig): Promise<number> {
        const promise = async (connection: Connection) => {
            return connection.getBalance(publicKey, commitmentOrConfig);
        };

        return MagicConnectionMethod(promise, this.proxyOptions.rpcs, this.proxyOptions.maxRetries, this.proxyOptions.timeout);
    }

    getParsedTokenAccountsByOwner(ownerAddress: PublicKey, filter: TokenAccountsFilter, commitment?: Commitment): Promise<RpcResponseAndContext<Array<{
        pubkey: PublicKey;
        account: AccountInfo<ParsedAccountData>;
    }>>> {
        const promise = async (connection: Connection) => {
            return connection.getParsedTokenAccountsByOwner(ownerAddress, filter, commitment);
        };

        return MagicConnectionMethod(promise, this.proxyOptions.rpcs, this.proxyOptions.maxRetries, this.proxyOptions.timeout);
    }


    simulateTransaction(
        transactionOrMessage: Transaction | Message | VersionedTransaction,
        configOrSigners?: Array<Signer> | SimulateTransactionConfig,
        includeAccounts?: boolean | Array<PublicKey>
    ): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
        const promise = async (connection: Connection): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> => {
            if (transactionOrMessage instanceof VersionedTransaction) {
                return connection.simulateTransaction(
                    transactionOrMessage,
                    configOrSigners as SimulateTransactionConfig
                );

            } else {
                return connection.simulateTransaction(
                    transactionOrMessage as Transaction | Message,
                    configOrSigners as Array<Signer>,
                    includeAccounts
                );
            }
        };

        return MagicConnectionMethod(promise, this.proxyOptions.rpcs, this.proxyOptions.maxRetries, this.proxyOptions.timeout);
    }



    sendTransaction(transaction: Transaction, signers: Array<Signer>, options?: SendOptions): Promise<TransactionSignature>;
    sendTransaction(transaction: VersionedTransaction, options?: SendOptions): Promise<TransactionSignature>;

    sendTransaction(arg1: Transaction | VersionedTransaction, arg2?: any, arg3?: any): Promise<TransactionSignature> {
        const promise = async (connection: Connection): Promise<TransactionSignature> => {
            return arg1 instanceof VersionedTransaction
                ? connection.sendTransaction(arg1, arg2)
                : connection.sendTransaction(arg1, arg2, arg3);
        };

        return MagicConnectionMethod(promise, this.proxyOptions.rpcs, this.proxyOptions.maxRetries, this.proxyOptions.timeout);
    }


    getAccountInfo(publicKey: PublicKey, commitmentOrConfig?: Commitment | GetAccountInfoConfig): Promise<AccountInfo<Buffer> | null> {
        const promise = async (connection: Connection) => {
            return connection.getAccountInfo(publicKey, commitmentOrConfig);
        };

        return MagicConnectionMethod(promise, this.proxyOptions.rpcs, this.proxyOptions.maxRetries, this.proxyOptions.timeout);
    }
}




export async function MagicConnectionMethod<T>(
    executor: (connection: Connection) => Promise<T>,
    rpcs: string[],
    maxRetries = 3,
    timeout = 15000
): Promise<T> {

    // Créer une map pour stocker les erreurs par RPC
    const errors = new Map<string, string>();

    // Créer les promesses pour chaque RPC
    const promises = rpcs.map(async (rpcUrl) => {
        const connection = new Connection(rpcUrl);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                //console.log(`[RPC ${rpcUrl}] Tentative ${attempt}/${maxRetries} pour récupérer le résultat ${signature}`);

                const result = await executor(connection);

                if (result) {
                    console.log(`[RPC ${rpcUrl}] Résultat trouvé ✅`);
                    return result;

                } else {
                    //console.log(`[RPC ${rpcUrl}] Résultat non trouvé (tentative ${attempt}/${maxRetries})`);

                    // Attendre un peu plus longtemps à chaque tentative
                    if (attempt < maxRetries) {
                        const delay = 1000 * attempt;
                        await sleep(delay);
                    }
                }

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                errors.set(rpcUrl, errorMessage);
                //console.error(`[RPC ${rpcUrl}] Erreur (tentative ${attempt}/${maxRetries}): ${errorMessage}`);

                // Attendre avant de réessayer
                if (attempt < maxRetries) {
                    await sleep(1000);
                }
            }
        }

        // Si toutes les tentatives échouent pour ce RPC, rejeter la promesse
        throw new Error(`Échec après ${maxRetries} tentatives pour le RPC ${rpcUrl}`);
    });


    // Ajouter un timeout global
    let timeoutId: NodeJS.Timeout | number | null = null;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
            console.error(`⏱️ Timeout global de ${timeout}ms dépassé sur tous les RPCs`);
            reject(new Error(`Timeout global de ${timeout}ms dépassé`));
        }, timeout);
    });


    // Race entre toutes les promesses et le timeout
    try {
        return await Promise.race([...promises, timeoutPromise]);

    } catch (err: any) {
        console.error("Toutes les tentatives ont échoué:", err);

        // Afficher un résumé des erreurs
        if (errors.size > 0) {
            console.error("Résumé des erreurs par RPC:");
            errors.forEach((error, rpc) => {
                console.error(`- ${rpc}: ${error}`);
            });
        }

        throw err;

    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}






if (require.main === module) {
    const rpcs: string[] = [
        appConfig.solana.rpc.helius,
        //        appConfig.solana.rpc.heliusJpp,
        //        appConfig.solana.rpc.quicknode,
        //        appConfig.solana.rpc.alchemy,
        //    //    appConfig.solana.rpc.drpc,
        //        appConfig.solana.rpc.getblock,
        appConfig.solana.rpc.chainstack,
        appConfig.solana.rpc.shyft,
    ];

    const connection = new MagicConnection({ rpcs });


    //const signature = "6649w1sPRT5vRMyPSRMruaBPJu6FpXy1km7yuhZ3R72QjVvaoibDsg3jt36sSJpSefVJ9q5dVQ14i21m69ku1L4K";

    //connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
    //    .then((result) => {
    //        console.log('result:', result);
    //    })

    connection.getBalance(new PublicKey('AtvQg4j6PXVwhqQbS66STU3jrVDsQrSixKq2SRW1rizE'))
        .then((result) => {
            console.log('result:', result);
        })

}


