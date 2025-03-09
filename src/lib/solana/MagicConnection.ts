// MagicConnection.ts

import { AccountInfo, AddressLookupTableAccount, Blockhash, BlockhashWithExpiryBlockHeight, BlockSignatures, Commitment, ConfirmedBlock, ConfirmedSignatureInfo, ConfirmedTransaction, ConfirmedTransactionMeta, Connection, ConnectionConfig, FeeCalculator, Finality, GetAccountInfoConfig, GetBalanceConfig, GetLatestBlockhashConfig, GetNonceAndContextConfig, GetNonceConfig, GetTransactionConfig, GetVersionedTransactionConfig, Message, NonceAccount, ParsedAccountData, ParsedConfirmedTransaction, ParsedTransactionWithMeta, PublicKey, RpcResponseAndContext, SendOptions, SignatureResult, SignaturesForAddressOptions, Signer, SimulatedTransactionResponse, SimulateTransactionConfig, TokenAccountsFilter, Transaction, TransactionConfirmationStrategy, TransactionResponse, TransactionSignature, VersionedTransaction, VersionedTransactionResponse } from "@solana/web3.js";

import { appConfig } from "../../env";
import { sleep } from "../utils/time.util";

/* ######################################################### */


export type MethodsOf<T> = {
    [K in keyof T]: T[K] extends Function ? K : never
}[keyof T];


export type MagicConnectionOptions = {
    rpcs: string[],
    maxRetries?: number,
    timeout?: number,
    maxRpcs?: number,
};


/* ######################################################### */


export class MagicConnection extends Connection {
    public proxyOptions: MagicConnectionOptions;

    constructor(proxyOptions: MagicConnectionOptions, commitmentOrConfig?: Commitment | ConnectionConfig) {
        super(proxyOptions.rpcs[0], commitmentOrConfig);
        this.proxyOptions = proxyOptions;
    }


    getTransaction(signature: string, rawConfig?: GetTransactionConfig): Promise<TransactionResponse | null>;
    getTransaction(signature: string, rawConfig: GetVersionedTransactionConfig): Promise<VersionedTransactionResponse | null>;

    getTransaction(signature: string, rawConfig?: GetTransactionConfig | GetVersionedTransactionConfig): Promise<TransactionResponse | VersionedTransactionResponse | null> {
        return MagicConnectionMethodWrapper(this, 'getTransaction', signature, rawConfig);
    }


    getTransactions(signatures: TransactionSignature[], commitmentOrConfig?: GetTransactionConfig | Finality): Promise<(TransactionResponse | null)[]>;
    getTransactions(signatures: TransactionSignature[], commitmentOrConfig: GetVersionedTransactionConfig | Finality): Promise<(VersionedTransactionResponse | null)[]>;
    getTransactions(signatures: TransactionSignature[], commitmentOrConfig: GetVersionedTransactionConfig | Finality): Promise<((VersionedTransactionResponse | null) | (TransactionResponse | null))[]> {
        return MagicConnectionMethodWrapper(this, 'getTransactions', signatures, commitmentOrConfig);
    }


    getParsedTransaction(signature: TransactionSignature, commitmentOrConfig?: GetVersionedTransactionConfig | Finality): Promise<ParsedTransactionWithMeta | null> {
        return MagicConnectionMethodWrapper(this, 'getParsedTransaction', signature, commitmentOrConfig);
    }


    getParsedTransactions(signatures: TransactionSignature[], commitmentOrConfig?: GetVersionedTransactionConfig | Finality): Promise<(ParsedTransactionWithMeta | null)[]> {
        return MagicConnectionMethodWrapper(this, 'getParsedTransaction', signatures, commitmentOrConfig);
    }


    getBalance(publicKey: PublicKey, commitmentOrConfig?: Commitment | GetBalanceConfig): Promise<number> {
        return MagicConnectionMethodWrapper(this, 'getBalance', publicKey, commitmentOrConfig);
    }


    getParsedTokenAccountsByOwner(ownerAddress: PublicKey, filter: TokenAccountsFilter, commitment?: Commitment): Promise<RpcResponseAndContext<Array<{
        pubkey: PublicKey;
        account: AccountInfo<ParsedAccountData>;
    }>>> {
        return MagicConnectionMethodWrapper(this, 'getParsedTokenAccountsByOwner', ownerAddress, filter, commitment);
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

        return MagicConnectionMethod(promise, this.proxyOptions.rpcs, this.proxyOptions.maxRetries, this.proxyOptions.timeout, this.proxyOptions.maxRpcs, 'simulateTransaction');
    }



    sendTransaction(transaction: Transaction, signers: Array<Signer>, options?: SendOptions): Promise<TransactionSignature>;
    sendTransaction(transaction: VersionedTransaction, options?: SendOptions): Promise<TransactionSignature>;

    sendTransaction(arg1: Transaction | VersionedTransaction, arg2?: any, arg3?: any): Promise<TransactionSignature> {
        const promise = async (connection: Connection): Promise<TransactionSignature> => {
            return arg1 instanceof VersionedTransaction
                ? connection.sendTransaction(arg1, arg2)
                : connection.sendTransaction(arg1, arg2, arg3);
        };

        return MagicConnectionMethod(promise, this.proxyOptions.rpcs, this.proxyOptions.maxRetries, this.proxyOptions.timeout, this.proxyOptions.maxRpcs, 'sendTransaction');
    }


    getAccountInfo(publicKey: PublicKey, commitmentOrConfig?: Commitment | GetAccountInfoConfig): Promise<AccountInfo<Buffer> | null> {
        return MagicConnectionMethodWrapper(this, 'getAccountInfo', publicKey, commitmentOrConfig);
    }


    confirmTransaction(strategy: TransactionConfirmationStrategy, commitment?: Commitment): Promise<RpcResponseAndContext<SignatureResult>>
    confirmTransaction(strategy: TransactionSignature, commitment?: Commitment): Promise<RpcResponseAndContext<SignatureResult>>;

    confirmTransaction(strategy: TransactionConfirmationStrategy | TransactionSignature, commitment: Commitment) {
        return MagicConnectionMethodWrapper(this, 'confirmTransaction', strategy, commitment);
    }


    getLatestBlockhash(commitmentOrConfig?: Commitment | GetLatestBlockhashConfig): Promise<BlockhashWithExpiryBlockHeight> {
        return MagicConnectionMethodWrapper(this, 'confirmTransaction', commitmentOrConfig);
    }


    getRecentBlockhash(commitment?: Commitment): Promise<{ blockhash: Blockhash, feeCalculator: FeeCalculator }> {
        return MagicConnectionMethodWrapper(this, 'confirmTransaction', commitment);
    }


    getConfirmedBlock(slot: number, commitment?: Finality): Promise<ConfirmedBlock> {
        return MagicConnectionMethodWrapper(this, 'getConfirmedBlock', slot, commitment);
    }


    getBlocks(startSlot: number, endSlot?: number, commitment?: Finality): Promise<Array<number>> {
        return MagicConnectionMethodWrapper(this, 'getBlocks', startSlot, endSlot, commitment);
    }


    getBlockSignatures(slot: number, commitment?: Finality): Promise<BlockSignatures> {
        return MagicConnectionMethodWrapper(this, 'getBlockSignatures', slot, commitment);
    }


    getConfirmedBlockSignatures(slot: number, commitment?: Finality): Promise<BlockSignatures> {
        return MagicConnectionMethodWrapper(this, 'getConfirmedBlockSignatures', slot, commitment);
    }


    getConfirmedTransaction(signature: TransactionSignature, commitment?: Finality): Promise<ConfirmedTransaction | null> {
        return MagicConnectionMethodWrapper(this, 'getConfirmedTransaction', signature, commitment);
    }


    getParsedConfirmedTransaction(signature: TransactionSignature, commitment?: Finality): Promise<ParsedConfirmedTransaction | null> {
        return MagicConnectionMethodWrapper(this, 'getParsedConfirmedTransaction', signature, commitment);
    }


    getParsedConfirmedTransactions(signatures: TransactionSignature[], commitment?: Finality): Promise<(ParsedConfirmedTransaction | null)[]> {
        return MagicConnectionMethodWrapper(this, 'getParsedConfirmedTransactions', signatures, commitment);
    }


    getSignaturesForAddress(address: PublicKey, options?: SignaturesForAddressOptions, commitment?: Finality): Promise<Array<ConfirmedSignatureInfo>> {
        return MagicConnectionMethodWrapper(this, 'getSignaturesForAddress', address, options);
    }


    getAddressLookupTable(accountKey: PublicKey, config?: GetAccountInfoConfig): Promise<RpcResponseAndContext<AddressLookupTableAccount | null>> {
        return MagicConnectionMethodWrapper(this, 'getAddressLookupTable', accountKey, config);
    }


    getNonceAndContext(nonceAccount: PublicKey, commitmentOrConfig?: Commitment | GetNonceAndContextConfig): Promise<RpcResponseAndContext<NonceAccount | null>> {
        return MagicConnectionMethodWrapper(this, 'getNonceAndContext', nonceAccount, commitmentOrConfig);
    }

    getNonce(nonceAccount: PublicKey, commitmentOrConfig?: Commitment | GetNonceConfig): Promise<NonceAccount | null> {
        return MagicConnectionMethodWrapper(this, 'getNonce', nonceAccount, commitmentOrConfig);
    }
}



export async function MagicConnectionMethodWrapper<T>(
    classInstance: MagicConnection,
    methodName: MethodsOf<Connection>,
    ...args: any[]
): Promise<T> {
    // Créer une fonction qui appelle la méthode sur une instance de Connection
    const promise = async (connection: Connection) => {
        // Récupérer la méthode à partir du nom
        const method = connection[methodName] as (...args: any[]) => Promise<T>;

        // Vérifier que la méthode existe et est une fonction
        if (typeof method !== 'function') {
            throw new Error(`La méthode ${String(methodName)} n'existe pas ou n'est pas une fonction`);
        }

        // Appeler la méthode avec les arguments fournis
        return method.apply(connection, args);
    };

    // Utiliser MagicConnectionMethod pour exécuter la promesse sur plusieurs RPCs
    return MagicConnectionMethod<T>(
        promise,
        classInstance.proxyOptions.rpcs,
        classInstance.proxyOptions.maxRetries,
        classInstance.proxyOptions.timeout,
        classInstance.proxyOptions.maxRpcs,
        methodName
    );
}



export async function MagicConnectionMethod<T>(
    executor: (connection: Connection) => Promise<T>,
    rpcs: string[],
    maxRetries = 3,
    timeout = 10_000,
    maxRpcs = 5,
    methodName?: string
): Promise<T> {

    const elligiblesRpcs = maxRpcs ? [...rpcs].sort((a,b) => Math.random() - 0.5).slice(0, maxRpcs) : rpcs;

    // Créer une map pour stocker les erreurs par RPC
    const errors = new Map<string, string>();
    let firstFounder: string | null = null;

    // Créer les promesses pour chaque RPC
    const promises = elligiblesRpcs.map(async (rpcUrl) => {
        const connection = new Connection(rpcUrl);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (firstFounder) {
                throw new Error(`⚠️ Un autre RPC (${firstFounder}) a déjà trouvé le résultat (RPC ${rpcUrl})`);
            }

            try {
                //log(`Tentative ${attempt}/${maxRetries} pour récupérer le résultat ${methodName ? `de la méthode "${methodName}"` : ''} (RPC ${rpcUrl})`);

                const result = await executor(connection);

                if (firstFounder) {
                    throw new Error(`⚠️ Un autre RPC (${firstFounder}) a déjà trouvé le résultat (RPC ${rpcUrl})`);
                }

                if (result) {
                    //log(`✅ Résultat trouvé ${methodName ? `(${methodName})` : ''} ✅ (RPC ${rpcUrl})`);
                    firstFounder = rpcUrl;
                    return result;

                } else {
                    //log(`⚠️ Résultat non trouvé (tentative ${attempt}/${maxRetries}) (RPC ${rpcUrl})`);

                    // Attendre un peu plus longtemps à chaque tentative
                    if (attempt < maxRetries) {
                        const delay = 1000 * attempt;
                        await sleep(delay);
                    }
                }

            } catch (err: any) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                errors.set(rpcUrl, errorMessage);
                console.error(`Erreur (tentative ${attempt}/${maxRetries}): ${errorMessage} (RPC ${rpcUrl})`);

                if (!maxRetries) throw err;

                if (firstFounder) {
                    throw new Error(`⚠️ Un autre RPC (${firstFounder}) a déjà trouvé le résultat (RPC ${rpcUrl})`);
                }

                // Attendre avant de réessayer
                if (attempt < maxRetries) {
                    //await sleep(1000);
                    await sleep(timeout / maxRetries);
                }
            }
        }

        // Si toutes les tentatives échouent pour ce RPC, rejeter la promesse
        throw new Error(`🚨 Échec après ${maxRetries} tentatives (RPC ${rpcUrl})`);
    });


    // Ajouter un timeout global
    let timeoutId: NodeJS.Timeout | number | null = null;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
            console.error(`❌ Timeout global de ${timeout}ms dépassé sur les ${elligiblesRpcs.length} RPCs ${methodName ? `(${methodName})` : ''}`);
            reject(new Error(`Timeout global de ${timeout}ms dépassé`));
        }, timeout);
    });


    // Race entre toutes les promesses et le timeout
    try {
        return await Promise.race([...promises, timeoutPromise]);

    } catch (err: any) {
        console.error(`Toutes les tentatives ${methodName ? `(${methodName})` : ''} ont échoué: ${err.message}`);

        // Afficher un résumé des erreurs
        if (errors.size > 0) {
            console.error("Résumé des erreurs par RPC:");
            errors.forEach((error, rpc) => {
                console.error(`👉 ${rpc}: ${error}`);
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





function log(message: string) {
    console.log(`${now()} | ${message}`)
}


function now(date?: Date) {
    const dateFormatted = getUsDateTime(date);
    return dateFormatted.replace(' ', ' | ');
}


function getUsDateTime(date?: Date) {
    if (date === null) return '';
    date = date ?? new Date;
    return `${getUsDate(date)} ${date.toLocaleTimeString('fr-FR', { timeStyle: 'medium' })}`;
}


function getUsDate(date?: Date) {
    if (date === null) return '';
    date = date ?? new Date;
    return date.toLocaleDateString('fr-FR', { dateStyle: 'short' }).split('/').reverse().join('-');
}
