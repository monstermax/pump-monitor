// pumpfun_create_buy_sell.ts

import { Commitment, Connection, PublicKey } from "@solana/web3.js";

import { DEFAULT_COMMITMENT } from "./pumpfun_tx";
import { BondingCurveAccount, getBondingCurvePDA } from "./pumpfun_bondingcurve_account";


/* ######################################################### */

export const PUMPFUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
//export const MPL_TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export const GLOBAL_ACCOUNT_SEED = "global";
export const MINT_AUTHORITY_SEED = "mint-authority";
export const BONDING_CURVE_SEED = "bonding-curve";
export const METADATA_SEED = "metadata";

export const DEFAULT_DECIMALS = 6;

//export const FEE_RECIPIENT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"); // old
export const FEE_RECIPIENT = new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV"); // new 2025-03-09

/* ######################################################### */


export type CreateTokenMetadata = {
    name: string;
    symbol: string;
    description: string;
    file: Blob;
    twitter?: string;
    telegram?: string;
    website?: string;
};

export type TokenMetadata = {
    name: string;
    symbol: string;
    description: string;
    image: string;
    showName: boolean;
    createdOn: string;
    twitter: string;
};

export type CreateEvent = {
    name: string;
    symbol: string;
    uri: string;
    mint: PublicKey;
    bondingCurve: PublicKey;
    user: PublicKey;
};

export type TradeEvent = {
    mint: PublicKey;
    solAmount: bigint;
    tokenAmount: bigint;
    isBuy: boolean;
    user: PublicKey;
    timestamp: number;
    virtualSolReserves: bigint;
    virtualTokenReserves: bigint;
    realSolReserves: bigint;
    realTokenReserves: bigint;
};

export type CompleteEvent = {
    user: PublicKey;
    mint: PublicKey;
    bondingCurve: PublicKey;
    timestamp: number;
};

export type SetParamsEvent = {
    feeRecipient: PublicKey;
    initialVirtualTokenReserves: bigint;
    initialVirtualSolReserves: bigint;
    initialRealTokenReserves: bigint;
    tokenTotalSupply: bigint;
    feeBasisPoints: bigint;
};

export interface PumpFunEventHandlers {
    createEvent: CreateEvent;
    tradeEvent: TradeEvent;
    completeEvent: CompleteEvent;
    setParamsEvent: SetParamsEvent;
}

export type PumpFunEventType = keyof PumpFunEventHandlers;



/* ######################################################### */


export function calculateWithSlippageBuy(amount: bigint, basisPoints: bigint) {
    return amount + (amount * basisPoints) / 10000n;
};


export function calculateWithSlippageSell(amount: bigint, basisPoints: bigint) {
    return amount - (amount * basisPoints) / 10000n;
};



// Accounts

export async function getTokenBondingCurveAccount(
    connection: Connection,
    mint: PublicKey,
    commitment: Commitment = DEFAULT_COMMITMENT
) {
    const tokenAccount = await connection.getAccountInfo(
        getBondingCurvePDA(mint),
        commitment
    );
    if (!tokenAccount) {
        return null;
    }
    return BondingCurveAccount.fromBuffer(tokenAccount!.data);
}


export function getGlobalAccountPubKey(): PublicKey {
    const globalAccountPubKey = PublicKey.findProgramAddressSync(
        [Buffer.from("global")],
        new PublicKey(PUMPFUN_PROGRAM_ID)
    )[0];
    return globalAccountPubKey;
}


/*
export async function getGlobalAccount(connection: Connection, commitment: Commitment = DEFAULT_COMMITMENT) {
    const [globalAccountPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from(GLOBAL_ACCOUNT_SEED)],
        new PublicKey(PUMPFUN_PROGRAM_ID)
    );

    const tokenAccount = await connection.getAccountInfo(globalAccountPDA, commitment);

    return GlobalAccount.fromBuffer(tokenAccount!.data);
}


export function getBondingCurvePDA(mint: PublicKey) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from(BONDING_CURVE_SEED), mint.toBuffer()],
        new PublicKey(PUMPFUN_PROGRAM_ID) //program.programId
    )[0];
}
*/


