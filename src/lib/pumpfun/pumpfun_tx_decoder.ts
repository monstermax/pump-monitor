// pumpfun_tx_decoder.ts

import fs from 'fs';
import { ParsedTransactionWithMeta, PublicKey, SendTransactionError, VersionedTransactionResponse } from "@solana/web3.js";

import { TradeTransactionResult } from './pumpfun_trading';

/* ######################################################### */

// Note: ce code est utile parce que je ne souhaite pas utiliser la lib @coral-xyz/anchor pour décoder le program pump.fun (avec l'IDL)


export interface PumpTokenInfo {
    tokenAddress: string;                 // Adresse du token (se terminant par "pump")
    createdAt: Date;                      // Date de création du token
    lastUpdated: Date;                    // Date de derniere mise à jour du token (dernier trade)
    creatorAddress: string;               // Adresse du créateur
    creatorTokenAccount: string;          // Compte de token associé au créateur
    bondingCurveAddress: string;          // Adresse de la bonding curve
    bondingCurveTokenAccount: string;     // Compte de token associé à la bonding curve
    totalSupply: string;                  // Supply totale du token
    decimals: number;                     // Nombre de décimales du token
    bondingCurveTokenBalance: number;     // Quantité de tokens dans la bonding curve
    bondingCurveSolBalance: number;       // Quantité de SOL dans la bonding curve (en SOL)
    price: string;                        // Prix estimé du token
    virtualSolReserves?: number;          // Réserves virtuelles en SOL (lamports)
    virtualTokenReserves?: number;        // Réserves virtuelles en tokens
    tokenName?: string;                   // Nom du token (si disponible dans les métadonnées)
    tokenSymbol?: string;                 // Symbole du token (si disponible dans les métadonnées)
    metadataUri?: string;                 // URI des métadonnées
    marketCapSol?: number;                // MaerrketCap en SOL
    initialBuy?: TradeInfo;               // Achat initial du dev
    signature: string;                    // signature de la transaction
    instructionIdx: number;
};


export interface TradeInfo {
    tradeType: 'buy' | 'sell',
    tokenAddress: string;
    traderAddress: string;
    bondingCurveAddress: string;
    feeAmount: number;
    solAmount: number;
    tokenAmount: number;
    price: string;
    traderPreBalanceSol: number;
    traderPostBalanceSol: number;
    traderPostBalanceToken: number;
    traderPostPercentToken: number;
    virtualSolReserves: number;
    virtualTokenReserves: number;
    realSolReserves: number;
    realTokenReserves: number;
    marketCapSol: number;
    timestamp: Date;
    signature: string;
    instructionIdx: number;
}


export interface TradeLog {
    mint: string;
    isBuy: boolean;
    user: string;
    timestamp: number;
    solAmount: number;
    tokenAmount: number;
    realSolReserves: number;
    realTokenReserves: number;
    virtualSolReserves: number;
    virtualTokenReserves: number;
}


export enum PumpInstructionType {
    Create = 'create',
    Buy = 'buy',
    Sell = 'sell',
    PumpParallel = 'pumpparallel',
    UNKNOWN = 'unknown'
};



/* ######################################################### */


export class TransactionDecoder {

    /** Parse une transaction Pump.fun et extrait les informations clés */
    parsePumpTransactionResponse(txResponse: VersionedTransactionResponse): PumpTokenInfo | TradeInfo | SendTransactionError | null {
        try {
            // Déterminer le type d'instruction
            const instructionType = detectInstructionType(txResponse);

            // En fonction du type, appeler le bon parseur
            if (instructionType === 'create') {
                const tokenInfo = this.parseCreateInstruction(txResponse);
                let initialBuy: PumpTokenInfo["initialBuy"] = undefined;

                // Vérifier s'il y a un achat initial
                if (txResponse.meta?.logMessages && hasInitialBuy(txResponse.meta.logMessages)) {
                    const buyResult: TradeInfo = this.parseBuyInstruction(txResponse);
                    initialBuy = buyResult;

                    //fs.writeFileSync(`${__dirname}/../../../tmp/pump_tx_result_create_and_buy.json`, JSON.stringify(txData, null, 4));
                } else {

                    //fs.writeFileSync(`${__dirname}/../../../tmp/pump_tx_result_create.json`, JSON.stringify(txData, null, 4));
                }

                const result: PumpTokenInfo = { ...tokenInfo, initialBuy };
                return result;

            } else if (instructionType === 'buy') {
                //fs.writeFileSync(`${__dirname}/../../../tmp/pump_tx_result_buy.json`, JSON.stringify(txData, null, 4));

                const buyResult: TradeInfo = this.parseBuyInstruction(txResponse);
                return buyResult;

            } else if (instructionType === 'sell') {
                //fs.writeFileSync(`${__dirname}/../../../tmp/pump_tx_result_sell.json`, JSON.stringify(txData, null, 4));

                const sellResult: TradeInfo = this.parseSellInstruction(txResponse);
                return sellResult;

            } else if (instructionType === 'pumpparallel') {
                fs.writeFileSync(`${__dirname}/../../../tmp/pump_tx_result_pumpparallel.json`, JSON.stringify(txResponse, null, 4));

                //const pumpparallelResult: TradeInfo = parsePumpParallelInstruction(txData);
                //return pumpparallelResult;

                //throw new Error(`Instruction "PumpParallel" non implémentée`);

                //console.warn(`Instruction "PumpParallel" non implémentée`);
                return null;
            }

            const logs = txResponse.meta?.logMessages?.filter(log => log.includes('failed:')) ?? [];

            if (logs.length > 0) {
                const error = new SendTransactionError({ action: 'send', signature: txResponse.transaction.signatures[0], logs, transactionMessage: logs[0] });
                return error;
            }

            //throw new Error(`Type d'instruction non reconnu. ${logs.join(' | ')}`);

            //console.warn(`Type d'instruction non reconnu. ${logs.join(' | ')}`);
            return null;

        } catch (err: any) {
            if (err instanceof SendTransactionError) {
                return err;

            } else {
                throw err;
            }
        }
    }



    /** Parse une instruction de création de token */
    parseCreateInstruction(txData: VersionedTransactionResponse): PumpTokenInfo {
        // Vérifier que les données nécessaires sont présentes
        if (!txData || !txData.meta || !txData.transaction || !txData.transaction.message) {
            throw new Error('Données de transaction invalides ou incomplètes');
        }

        const tokenAddress = txData.meta.postTokenBalances?.[0]?.mint || '';
        const createdAt = new Date(1000 * (txData.blockTime || 0));

        const accounts = txData.transaction.message.staticAccountKeys.map(key => key.toString());
        const creatorAddress = accounts[0] || '';

        // Dans une transaction CREATE, le compte du créateur est généralement à l'index 5
        const creatorTokenAccount = txData.meta.postTokenBalances?.[1]?.accountIndex !== undefined ?
            accounts[txData.meta.postTokenBalances[1].accountIndex] :
            accounts[5] || '';

        const bondingCurveAddress = txData.meta.postTokenBalances?.[0]?.owner || '';
        const bondingCurveTokenAccount = txData.meta.postTokenBalances?.[0]?.accountIndex !== undefined ?
            accounts[txData.meta.postTokenBalances[0].accountIndex] :
            accounts[3] || '';

        const decimals = txData.meta.postTokenBalances?.[0]?.uiTokenAmount?.decimals || 0;
        const bondingCurveTokenBalance = txData.meta.postTokenBalances?.[0]?.uiTokenAmount?.uiAmount || 0;
        const creatorTokenBalance = txData.meta.postTokenBalances?.[1]?.uiTokenAmount?.uiAmount || 0;
        const totalSupply = (bondingCurveTokenBalance + creatorTokenBalance).toString();


        // Calculer la quantité de SOL dans la bonding curve
        let bondingCurveSolBalance = 0;
        if (bondingCurveAddress) {
            const bondingCurveIndex = accounts.findIndex(
                key => key === bondingCurveAddress
            );

            if (bondingCurveIndex >= 0 && bondingCurveIndex < txData.meta.postBalances.length) {
                bondingCurveSolBalance = txData.meta.postBalances[bondingCurveIndex] / 1e9;
            }
        }


        // Valeurs spécifiques pour Pump.fun (à confirmer/vérifier) / Ces valeurs sont des valeurs par défaut pour les nouveaux tokens Pump.fun
        const virtualSolReserves = 30.000_000_004;
        const virtualTokenReserves = 1_073_000_000.000_000;


        // Calculer le prix avec la formule de la courbe de liaison
        const price = calculatePumpPrice(virtualSolReserves, virtualTokenReserves);
        const marketCapSol = Number(price) * virtualTokenReserves;

        const instructionIdx = txData.meta?.logMessages?.filter(log => log.startsWith('Program log: Instruction: ')).findIndex(log => log.startsWith('Program log: Instruction: Create')) ?? 0;

        // Extraire les informations du token
        const tokenInfo: PumpTokenInfo = {
            tokenAddress,
            createdAt,
            lastUpdated: createdAt,
            creatorAddress,
            creatorTokenAccount,
            bondingCurveAddress,
            bondingCurveTokenAccount,
            totalSupply,
            decimals,
            bondingCurveTokenBalance,
            bondingCurveSolBalance,
            price,
            virtualSolReserves,
            virtualTokenReserves,
            marketCapSol,
            signature: txData.transaction.signatures[0],
            instructionIdx,
        };

        // Extraire les métadonnées à partir des logs si disponibles
        if (txData.meta.logMessages) {
            const createEventSignature = Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]).toString('base64').replace(/=+$/, '');

            // Chercher le log "Program data" qui commence par la signature d'événement Create
            const dataLog = txData.meta.logMessages.find(log => log.startsWith(`Program data: ${createEventSignature}`));

            if (dataLog) {
                try {
                    const metadataExtracted = extractMetadataFromProgramData(dataLog);
                    if (metadataExtracted) {
                        tokenInfo.tokenName = metadataExtracted.name;
                        tokenInfo.tokenSymbol = metadataExtracted.symbol;
                        tokenInfo.metadataUri = metadataExtracted.uri;
                    }

                } catch (err: any) {
                    console.warn('Impossible d\'extraire les métadonnées:', err);
                }
            }
        }

        return tokenInfo;
    }


    /** Parse une instruction d'achat de token */
    parseBuyInstruction(txData: VersionedTransactionResponse): TradeInfo {
        const accounts = txData.transaction.message.staticAccountKeys.map(key => key.toString());
        const buyerAddress = accounts[0] || '';

        // Pour un achat, nous avons besoin d'identifier le token acheté
        const buyerTokenAccount = txData.meta?.postTokenBalances?.find(balance =>
            balance.owner === buyerAddress
        );

        const bondingCurveAddress = txData.meta?.postTokenBalances?.[0]?.owner || '';

        // Déterminer les montants avant/après
        const buyerIndex = accounts.findIndex(key => key === buyerAddress);
        let feeAmount = 0;
        let solAmount = 0;
        let tokenAmount = 0;

        if (buyerIndex >= 0 && txData.meta?.preBalances && txData.meta?.postBalances) {
            const preSolBalance = txData.meta.preBalances[buyerIndex] / 1e9;
            const postSolBalance = txData.meta.postBalances[buyerIndex] / 1e9;

            // Tenir compte des frais de transaction
            feeAmount = (txData.meta.fee || 0) / 1e9;

            solAmount = preSolBalance - postSolBalance - feeAmount; // déduction des frais de transaction pour le calcul du trade (hors taxe). les frais de pump.fun sont par contre inclus
        }


        if (buyerTokenAccount) {
            tokenAmount = buyerTokenAccount.uiTokenAmount.uiAmount ?? 0;
        }


        // Extraire les réserves de la bonding curve à partir des logs
        const tradeEventLog = txData.meta?.logMessages?.find(log =>
            log.startsWith('Program data: vdt/007mYe')  // Signature approximative d'un événement trade
        );


        if (!tradeEventLog) {
            const error = parseTradeError(txData.transaction.signatures[0], txData.meta?.logMessages ?? []);
            throw error;
        }

        const { mint, user, virtualSolReserves, virtualTokenReserves, realSolReserves, realTokenReserves } = parseTradeEvent(tradeEventLog ?? '');


        //const price = solAmount > 0 && tokenAmount > 0 ? solAmount / tokenAmount : 0; // faux, biaisé par les taxes pump.fun
        const price = calculatePumpPrice(virtualSolReserves, virtualTokenReserves)

        const marketCapSol = Number(price) * virtualTokenReserves;

        const traderPreBalanceSol = (buyerIndex >= 0 && txData.meta?.preBalances?.[buyerIndex]) ? txData.meta.preBalances[buyerIndex] / 1e9 : 0;
        const traderPostBalanceSol = (buyerIndex >= 0 && txData.meta?.postBalances?.[buyerIndex]) ? txData.meta.postBalances[buyerIndex] / 1e9 : 0;

        let buyerPostTokenAmount = 0;

        if (buyerTokenAccount) {
            // Utiliser directement la valeur post-transaction
            buyerPostTokenAmount = buyerTokenAccount.uiTokenAmount.uiAmount ?? 0;

        } else {
            // Chercher dans toutes les balances post-transaction
            const allBuyerTokenAccounts = txData.meta?.postTokenBalances?.filter(balance =>
                balance.owner === buyerAddress &&
                balance.mint === mint
            );

            // Additionner toutes les balances du même token si l'acheteur a plusieurs comptes
            if (allBuyerTokenAccounts && allBuyerTokenAccounts.length > 0) {
                buyerPostTokenAmount = allBuyerTokenAccounts.reduce((sum, account) => sum + (account.uiTokenAmount.uiAmount ?? 0), 0);
            }
        }


        const traderPostPercentToken = 100 * buyerPostTokenAmount / (buyerPostTokenAmount + virtualTokenReserves);

        const instructionIdx = txData.meta?.logMessages?.filter(log => log.startsWith('Program log: Instruction: ')).findIndex(log => log.startsWith('Program log: Instruction: Buy')) ?? 0;


        // Créer un objet pour stocker les informations de l'achat
        const buyInfo: TradeInfo = {
            tradeType: 'buy',
            tokenAddress: mint,
            traderAddress: buyerAddress,
            bondingCurveAddress,
            feeAmount,
            solAmount,
            tokenAmount,
            price,
            traderPreBalanceSol,
            traderPostBalanceSol,
            traderPostBalanceToken: buyerPostTokenAmount,
            traderPostPercentToken,
            virtualSolReserves,
            virtualTokenReserves,
            realSolReserves,
            realTokenReserves,
            marketCapSol,
            timestamp: new Date((txData.blockTime ?? 0) * 1000),
            signature: txData.transaction.signatures[0],
            instructionIdx,
        };


        return buyInfo;
    }


    /** Parse une instruction de vente de token */
    parseSellInstruction(txData: VersionedTransactionResponse): TradeInfo {

        // Pour une vente standard, nous avons besoin d'informations similaires à un achat
        const accounts = txData.transaction.message.staticAccountKeys.map(key => key.toString());
        const sellerAddress = accounts[0] || '';
        const sellerIndex = accounts.findIndex(key => key === sellerAddress);

        // Pour une vente, nous avons besoin d'identifier le token vendu
        const sellerTokenAccount = txData.meta?.preTokenBalances?.find(balance =>
            balance.owner === sellerAddress
        );

        const bondingCurveAddress = txData.meta?.postTokenBalances?.[0]?.owner || '';


        // Déterminer les montants avant/après

        // Pour une vente, le vendeur reçoit des SOL
        let sellerPreSolBalance = 0;
        let sellerPostSolBalance = 0;
        let feeAmount = 0;

        if (sellerIndex >= 0 && txData.meta?.preBalances && txData.meta?.postBalances) {
            sellerPreSolBalance = txData.meta.preBalances[sellerIndex] / 1e9;
            sellerPostSolBalance = txData.meta.postBalances[sellerIndex] / 1e9;

            feeAmount = (txData.meta.fee || 0) / 1e9;
        }

        const solAmount = sellerPostSolBalance - sellerPreSolBalance + feeAmount; // déduction des frais de transaction pour le calcul du trade (hors taxe). les frais de pump.fun sont par contre inclus


        // Calculer les tokens vendus
        let sellerPreTokenAmount = 0;
        let sellerPostTokenAmount = 0;

        if (sellerTokenAccount && txData.meta?.postTokenBalances) {
            const postSellerTokenAccount = txData.meta.postTokenBalances.find(balance =>
                balance.owner === sellerAddress
            );

            if (postSellerTokenAccount && sellerTokenAccount) {
                sellerPreTokenAmount = sellerTokenAccount.uiTokenAmount.uiAmount ?? 0;
                sellerPostTokenAmount = postSellerTokenAccount.uiTokenAmount.uiAmount ?? 0;
            }
        }

        const tokenAmount = sellerPreTokenAmount - sellerPostTokenAmount;


        // Extraire les réserves de la bonding curve à partir des logs
        const tradeEventLog = txData.meta?.logMessages?.find(log =>
            log.startsWith('Program data: vdt/007mYe')  // Signature approximative d'un événement trade
        );


        if (!tradeEventLog) {
            const error = parseTradeError(txData.transaction.signatures[0], txData.meta?.logMessages ?? []);
            throw error;
        }

        const { mint, user, virtualSolReserves, virtualTokenReserves, realSolReserves, realTokenReserves } = parseTradeEvent(tradeEventLog ?? '');


        //const price = solAmount > 0 && tokenAmount > 0 ? solAmount / tokenAmount : 0; // faux, biaisé par les taxes pump.fun
        const price = calculatePumpPrice(virtualSolReserves, virtualTokenReserves);

        const marketCapSol = Number(price) * virtualTokenReserves;

        const traderPreBalanceSol = (sellerIndex >= 0 && txData.meta?.preBalances?.[sellerIndex]) ? txData.meta.preBalances[sellerIndex] / 1e9 : 0;
        const traderPostBalanceSol = (sellerIndex >= 0 && txData.meta?.postBalances?.[sellerIndex]) ? txData.meta.postBalances[sellerIndex] / 1e9 : 0;

        //const traderPostPercentToken_OLD = 100 * tokenAmount / (tokenAmount + virtualTokenReserves);
        const traderPostPercentToken = 100 * sellerPostTokenAmount / (sellerPostTokenAmount + virtualTokenReserves);

        const instructionIdx = txData.meta?.logMessages?.filter(log => log.startsWith('Program log: Instruction: ')).findIndex(log => log.startsWith('Program log: Instruction: Sell')) ?? 0;


        // Créer un objet pour stocker les informations de la vente
        const sellInfo: TradeInfo = {
            tradeType: 'sell',
            tokenAddress: mint,
            traderAddress: sellerAddress,
            bondingCurveAddress,
            feeAmount,
            solAmount,
            tokenAmount,
            price,
            traderPreBalanceSol,
            traderPostBalanceSol, // TODO: fusionner traderPostBalanceSol et sellerPostSolBalance
            traderPostBalanceToken: sellerPostTokenAmount,
            traderPostPercentToken,
            virtualSolReserves,
            virtualTokenReserves,
            realSolReserves,
            realTokenReserves,
            marketCapSol,
            timestamp: new Date((txData.blockTime ?? 0) * 1000),
            signature: txData.transaction.signatures[0],
            instructionIdx,
        };


        return sellInfo;
    }



}




/** Détecte le type d'instruction principal dans la transaction */
export function detectInstructionType(txData: ParsedTransactionWithMeta | VersionedTransactionResponse): string {
    if (!txData.meta?.logMessages || txData.meta.logMessages.length === 0) {
        return PumpInstructionType.UNKNOWN;
    }

    // Vérifier les logs pour déterminer le type d'instruction
    const logMessages = txData.meta.logMessages;

    if (logMessages.some(log => log.startsWith('Program log: Instruction: Create'))) {
        return PumpInstructionType.Create;
    }

    if (logMessages.some(log => log.startsWith('Program log: Instruction: Buy'))) {
        return PumpInstructionType.Buy;
    }

    if (logMessages.some(log => log.startsWith('Program log: Instruction: Sell'))) {
        return PumpInstructionType.Sell;
    }

    if (logMessages.some(log => log.startsWith('Program log: Instruction: PumpParallel'))) {
        return PumpInstructionType.PumpParallel;
    }

    return PumpInstructionType.UNKNOWN;
}




export function parseTradeEvent(tradeEventLog: string): TradeLog {

    //const tradeEventDiscriminator = [189, 219, 127, 211, 78, 230, 97, 238]; // vdt/007mYe4 (mais pb quand signature commence par "vdt/007mYe5")
    //const tradeEventSignature = Buffer.from(tradeEventDiscriminator).toString('base64').replace(/=+$/, '');
    const tradeEventSignature = "vdt/007mYe";

    if (!tradeEventLog.startsWith(`Program data: ${tradeEventSignature}`)) {
        throw new Error(`Signature invalide. Impossible de décoder les données`);
    }


    // Décoder les données Base64
    const prefix = "Program data: ";
    const base64Data = tradeEventLog.substring(tradeEventLog.indexOf(prefix) + prefix.length);
    const rawData = Buffer.from(base64Data, 'base64');

    // La signature de l'événement est dans les 8 premiers octets (ignorer pour la flexibilité)
    let offset = 8;

    // Lire la clé publique du token (mint)
    const mint = new PublicKey(Buffer.from(rawData.slice(offset, offset + 32))).toBase58();
    offset += 32;

    // Lire le montant de SOL (u64)
    const solAmount = Number(rawData.readBigUInt64LE(offset)) / 1e9; // Convertir lamports en SOL
    offset += 8;

    // Lire le montant de tokens (u64)
    const tokenAmount = Number(rawData.readBigUInt64LE(offset)) / 1e6; // Convertir en tokens selon decimals
    offset += 8;

    // Lire le flag isBuy (boolean)
    const isBuy = rawData[offset] === 1;
    offset += 1;

    // Lire la clé publique de l'utilisateur
    const user = new PublicKey(Buffer.from(rawData.slice(offset, offset + 32))).toBase58();
    offset += 32;

    // Lire le timestamp (i64)
    const timestamp = Number(rawData.readBigInt64LE(offset));
    offset += 8;

    // Lire les réserves virtuelles de SOL (u64)
    const virtualSolReserves = Number(rawData.readBigUInt64LE(offset)) / 1e9;
    offset += 8;

    // Lire les réserves virtuelles de tokens (u64)
    const virtualTokenReserves = Number(rawData.readBigUInt64LE(offset)) / 1e6;
    offset += 8;

    // Lire les réserves réelles de SOL (u64)
    const realSolReserves = Number(rawData.readBigUInt64LE(offset)) / 1e9;
    offset += 8;

    // Lire les réserves réelles de tokens (u64)
    const realTokenReserves = Number(rawData.readBigUInt64LE(offset)) / 1e6;

    //console.log(`Réserves extraites - Virtuelles: ${virtualSolReserves} SOL / ${virtualTokenReserves} tokens, Réelles: ${realSolReserves} SOL / ${realTokenReserves} tokens`);

    const result: TradeLog = {
        mint,
        solAmount,
        tokenAmount,
        isBuy,
        user,
        timestamp,
        virtualSolReserves,
        virtualTokenReserves,
        realSolReserves,
        realTokenReserves,
    };

    return result;
}


export function parseTradeError(signature: string, logMessages: string[]): SendTransactionError {

    const tradeEventErrorLog = logMessages.find(log => log.startsWith('Program log: AnchorError thrown'));

    let errorCode = "";
    let errorNumber = "";
    let errorMessage = "";
    const logs: string[] = [];


    if (tradeEventErrorLog) {
        // Extraction du code d'erreur
        const codeMatch = tradeEventErrorLog.match(/Error Code: ([^\.]+)/);
        if (codeMatch && codeMatch[1]) {
            errorCode = codeMatch[1].trim();
        }

        // Extraction du numéro d'erreur
        const numberMatch = tradeEventErrorLog.match(/Error Number: (\d+)/);
        if (numberMatch && numberMatch[1]) {
            errorNumber = numberMatch[1].trim();
        }

        // Extraction du message d'erreur
        const messageMatch = tradeEventErrorLog.match(/Error Message: ([^\.]+)\./);
        if (messageMatch && messageMatch[1]) {
            errorMessage = messageMatch[1].trim();
        }

        logs.push(tradeEventErrorLog);

        const tradeEventErrorLogLeft = logMessages.find(log => log.startsWith('Program log: Left: '));
        if (tradeEventErrorLogLeft) {
            logs.push(tradeEventErrorLogLeft);
        }

        const tradeEventErrorLogRight = logMessages.find(log => log.startsWith('Program log: Right: '));
        if (tradeEventErrorLogRight) {
            logs.push(tradeEventErrorLogRight);
        }
    }


    const transactionMessage = errorMessage;

    const error = new SendTransactionError({ action: 'send', signature, logs, transactionMessage });

    return error;
}



/** Extrait les métadonnées à partir des données de programme encodées en Base64, pour une instruction "mintTo" */
export function extractMetadataFromProgramData(programDataLog: string): {
    name: string;
    symbol: string;
    uri: string;
    rawData?: Uint8Array;
} | null {
    try {
        // Vérifier que l'entrée est une chaîne non vide
        if (!programDataLog || typeof programDataLog !== 'string') {
            console.warn('Le log fourni n\'est pas une chaîne valide');
            return null;
        }

        const createEventSignature = Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]).toString('base64').replace(/=+$/, '');

        // Extraire la partie Base64 des données
        const prefix = `Program data: `;
        const prefixAndSig = `Program data: ${createEventSignature}`;

        if (!programDataLog.includes(prefixAndSig)) {
            console.warn(`Le format du log ne contient pas "${prefixAndSig}"`);
            return null;
        }

        const base64Data = programDataLog.substring(programDataLog.indexOf(prefix) + prefix.length);

        // Vérifier que les données Base64 sont valides
        if (!base64Data || base64Data.trim().length === 0) {
            console.warn('Les données Base64 sont vides');
            return null;
        }

        // Essayer de décoder les données Base64
        let rawData: Buffer;
        try {
            rawData = Buffer.from(base64Data, 'base64');

            // Vérifier que les données décodées ont une taille minimale
            // (un en-tête + au moins quelques octets pour contenir des métadonnées)
            if (rawData.length < 20) {
                console.warn('Les données décodées sont trop courtes pour contenir des métadonnées valides');
                return null;
            }

        } catch (err: any) {
            console.warn('Échec du décodage Base64:', err);
            return null;
        }


        // Sauter l'en-tête (les 8 premiers octets)
        let offset = 8;

        // Vérifier que nous avons suffisamment de données pour lire la longueur du nom
        if (offset + 4 > rawData.length) {
            console.warn('Données tronquées: impossible de lire la longueur du nom');
            return null;
        }


        // Lire la longueur du nom
        const nameLength = rawData.readUInt32LE(offset);
        offset += 4;

        // Vérifier que la longueur du nom est raisonnable
        if (nameLength === 0 || nameLength > 100) {
            console.warn(`La longueur du nom (${nameLength}) est hors des limites raisonnables`);
            return null;
        }

        // Vérifier que nous avons suffisamment de données pour lire le nom
        if (offset + nameLength > rawData.length) {
            console.warn('Données tronquées: impossible de lire le nom complet');
            return null;
        }

        // Lire le nom
        const name = rawData.slice(offset, offset + nameLength).toString('utf8');
        offset += nameLength;


        // Vérifier que nous avons suffisamment de données pour lire la longueur du symbole
        if (offset + 4 > rawData.length) {
            console.warn('Données tronquées: impossible de lire la longueur du symbole');
            return null;
        }

        // Lire la longueur du symbole
        const symbolLength = rawData.readUInt32LE(offset);
        offset += 4;

        // Vérifier que la longueur du symbole est raisonnable
        if (symbolLength === 0 || symbolLength > 20) {
            console.warn(`La longueur du symbole (${symbolLength}) est hors des limites raisonnables`);
            return null;
        }

        // Vérifier que nous avons suffisamment de données pour lire le symbole
        if (offset + symbolLength > rawData.length) {
            console.warn('Données tronquées: impossible de lire le symbole complet');
            return null;
        }

        // Lire le symbole
        const symbol = rawData.slice(offset, offset + symbolLength).toString('utf8');
        offset += symbolLength;



        // Vérifier que nous avons suffisamment de données pour lire la longueur de l'URI
        if (offset + 4 > rawData.length) {
            console.warn('Données tronquées: impossible de lire la longueur de l\'URI');
            return null;
        }

        // Lire la longueur de l'URI
        const uriLength = rawData.readUInt32LE(offset);
        offset += 4;

        // Vérifier que la longueur de l'URI est raisonnable
        if (uriLength === 0 || uriLength > 200) {
            console.warn(`La longueur de l'URI (${uriLength}) est hors des limites raisonnables`);
            return null;
        }

        // Vérifier que nous avons suffisamment de données pour lire l'URI
        if (offset + uriLength > rawData.length) {
            console.warn('Données tronquées: impossible de lire l\'URI complet');
            return null;
        }

        // Lire l'URI
        const uri = rawData.slice(offset, offset + uriLength).toString('utf8');

        // Vérifier que l'URI a un format valide (par exemple, commence par https:// pour les URI IPFS)
        if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
            console.warn('L\'URI n\'a pas un format d\'URL valide');
            // Ne pas retourner null car certains URI pourraient utiliser des protocoles différents
        }

        // Vérification spécifique pour les URIs IPFS de Pump.fun
        //if (uri.includes('ipfs') && !uri.match(/ipfs\/[a-zA-Z0-9]+/)) {
        //    console.warn('L\'URI IPFS ne semble pas avoir un format valide');
        //}


        return {
            rawData,
            name,
            symbol,
            uri,
            //mint,
            //bondingCurve,
            //user,
        };

    } catch (err: any) {
        console.error('Erreur lors de l\'extraction des métadonnées:', err);
        return null;
    }
}





/** Décode les informations d'une transaction liée à Pump.fun */
export function decodeTradeTransactionFromLogs(tx: ParsedTransactionWithMeta | null): TradeTransactionResult | null {
    if (!tx || !tx.meta) return null;

    try {
        // Vérifier si la transaction a réussi
        const success = tx.meta.err === null;

        // Chercher dans les logs pour déterminer le type et les détails
        let type: 'buy' | 'sell' | null = null;
        let mint: string | null = null;


        // Parcourir les logs pour trouver des indices
        const logs = tx.meta.logMessages || [];
        for (const log of logs) {
            if (log.includes('Instruction: Buy')) {
                type = 'buy';

            } else if (log.includes('Instruction: Sell')) {
                type = 'sell';
            }

            // Chercher des références au mint dans les logs
            const mintMatch = log.match(/mint: ([0-9a-zA-Z]{32,44})/);
            if (mintMatch && mintMatch[1]) {
                mint = mintMatch[1];
            }
        }


        // Si on n'a pas pu déterminer le type ou le mint, essayer d'autres méthodes
        if (!type || !mint) {
            // Parcourir les instructions pour trouver des informations
            if (tx.transaction && tx.transaction.message) {
                const message = tx.transaction.message;

                // Chercher les comptes qui pourraient être des mints
                const accounts = message.accountKeys;
                for (const account of accounts) {
                    // Les mints Pump.fun se terminent souvent par "pump"
                    if (account.pubkey && account.pubkey.toString().endsWith('pump')) {
                        mint = account.pubkey.toString();
                        break;
                    }
                }
            }
        }


        // Si on n'a toujours pas les informations nécessaires, analyser les changements de balances
        let tokenAmount = 0;
        let solAmount = 0;


        // Calculer les changements de balances de tokens
        if (tx.meta.postTokenBalances && tx.meta.preTokenBalances) {
            const preBalances = new Map();
            tx.meta.preTokenBalances.forEach(balance => {
                preBalances.set(`${balance.owner}-${balance.mint}`, balance.uiTokenAmount.uiAmount || 0);
            });

            tx.meta.postTokenBalances.forEach(balance => {
                const key = `${balance.owner}-${balance.mint}`;
                const pre = preBalances.get(key) || 0;
                const post = balance.uiTokenAmount.uiAmount || 0;
                const diff = post - pre; // TODO?: diviser par 1e6 ?

                if (Math.abs(diff) > 0) {
                    tokenAmount = Math.abs(diff);
                    mint = balance.mint;
                    type = diff > 0 ? 'buy' : 'sell';
                }
            });
        }


        // Calculer le changement de SOL
        if (tx.meta.preBalances && tx.meta.postBalances) {
            for (let i = 0; i < tx.meta.preBalances.length; i++) {
                const pre = tx.meta.preBalances[i];
                const post = tx.meta.postBalances[i];
                const diff = (post - pre) / 1e9; // Convertir lamports en SOL

                if (Math.abs(diff) > 0.001) { // Ignorer les petits changements (frais)
                    solAmount = Math.abs(diff);
                    // Si on n'a pas encore déterminé le type, le faire en fonction du changement de SOL
                    if (!type) {
                        type = diff < 0 ? 'buy' : 'sell';
                    }
                }
            }
        }


        // Si on n'a pas pu déterminer toutes les informations nécessaires
        if (!type || !mint) {
            console.warn("Impossible de décoder complètement la transaction");
            return null;
        }

        return {
            type,
            tokenAmount,
            solAmount,
            mint,
            success
        };

    } catch (err: any) {
        console.error("Erreur lors du décodage de la transaction:", err);
        return null;
    }
}






if (require.main === module) {
    try {
        const txData = JSON.parse(fs.readFileSync(`${__dirname}/../../../tmp/pump_tx_create_and_buy.json`).toString());

        const decoder = new TransactionDecoder;
        const tokenInfo = decoder.parsePumpTransactionResponse(txData);

        if (tokenInfo && 'tokenName' in tokenInfo) {
            // MINT
            console.log('Informations du token Pump.fun:');
            console.log('----------------------------');
            console.log(`Date du mint: ${tokenInfo.createdAt.toLocaleDateString()} ${tokenInfo.createdAt.toLocaleTimeString()}`);
            console.log(`Adresse du token: ${tokenInfo.tokenAddress}`);
            console.log(`Adresse du créateur: ${tokenInfo.creatorAddress}`);
            console.log(`Compte de token associé au créateur: ${tokenInfo.creatorTokenAccount}`);
            console.log(`Adresse de la bonding curve: ${tokenInfo.bondingCurveAddress}`);
            console.log(`Compte de token associé à la bonding curve: ${tokenInfo.bondingCurveTokenAccount}`);
            console.log(`Supply totale: ${tokenInfo.totalSupply} (${tokenInfo.decimals} décimales)`);
            console.log(`Tokens dans la bonding curve: ${tokenInfo.bondingCurveTokenBalance}`);
            console.log(`SOL dans la bonding curve: ${tokenInfo.bondingCurveSolBalance} SOL`);

            // Afficher les réserves virtuelles
            console.log(`Réserves virtuelles en SOL: ${tokenInfo.virtualSolReserves} SOL`);
            console.log(`Réserves virtuelles en tokens: ${tokenInfo.virtualTokenReserves}`);

            // Afficher le prix calculé avec la formule correcte
            console.log(`Prix initial: ${tokenInfo.price} SOL/token`);

            if (tokenInfo.tokenName || tokenInfo.tokenSymbol) {
                console.log(`Nom: ${tokenInfo.tokenName || 'N/A'}, Symbole: ${tokenInfo.tokenSymbol || 'N/A'}`);
            }

            if (tokenInfo.metadataUri) {
                console.log(`URI des métadonnées: ${tokenInfo.metadataUri}`);
            }

            if (tokenInfo.initialBuy) {
                console.log('initialBuy:', tokenInfo.initialBuy)
            }

            console.log('tokenInfo:', tokenInfo)
        }

    } catch (err: any) {
        console.error('Erreur lors de l\'analyse de la transaction:', err);
    }
}




/** Vérifie si la transaction contient un achat initial */
export function hasInitialBuy(logMessages: string[]): boolean {
    return logMessages.some(log => log.includes('Instruction: Create')) &&
        logMessages.some(log => log.includes('Instruction: Buy'));
}



/** Calcule le prix du token Pump.fun en utilisant la formule de la courbe de liaison */
export function calculatePumpPrice(virtualSolReserves: number, virtualTokenReserves: number): string {
    // Formule de prix Pump.fun: prix = sol_virtuel / token_virtuel

    // Prix en SOL par token
    const rawPrice = virtualSolReserves / virtualTokenReserves;

    return rawPrice.toFixed(10);
}


