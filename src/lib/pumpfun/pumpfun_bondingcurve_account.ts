// pumpfun_bondingcurve_account.ts

import { AccountInfo, Commitment, Connection, PublicKey } from "@solana/web3.js";
import { struct, bool, u64, Layout } from "@coral-xyz/borsh";

import { appConfig } from "../../env";
import { BONDING_CURVE_SEED, DEFAULT_COMMITMENT, PUMPFUN_PROGRAM_ID } from "./pumpfun_config";


/* ######################################################### */


export async function getBondingCurveAccount(connection: Connection, bondingCurvePDA: PublicKey, commitment: Commitment = DEFAULT_COMMITMENT): Promise<BondingCurveAccount | null> {
    const bondingCurveAccount: AccountInfo<Buffer<ArrayBufferLike>> | null = await connection.getAccountInfo(bondingCurvePDA, commitment)
        .catch((err: any) => {
            console.warn(`Erreur de récupération du compte "bonding-curve" ${bondingCurvePDA} => ${connection.rpcEndpoint} : ${err.message}`);
            return null;
        })

    if (!bondingCurveAccount) {
        return null;
    }

    const bondingCurveAccountDecoded: BondingCurveAccount = BondingCurveAccount.fromBuffer(bondingCurveAccount!.data);
    return bondingCurveAccountDecoded;
}


export function getBondingCurvePDA(mint: PublicKey) {
    const bondingCurvePDA =  PublicKey.findProgramAddressSync(
        [Buffer.from(BONDING_CURVE_SEED), mint.toBuffer()],
        new PublicKey(PUMPFUN_PROGRAM_ID)
    )[0];

    return bondingCurvePDA;
}



export async function getTokenBondingCurveAccount(connection: Connection, mint: PublicKey, commitment: Commitment = DEFAULT_COMMITMENT) {
    const tokenAccount = await connection.getAccountInfo(
        getBondingCurvePDA(mint),
        commitment
    );

    if (!tokenAccount) {
        return null;
    }

    const bondingCurveAccountDecoded = BondingCurveAccount.fromBuffer(tokenAccount!.data);
    return bondingCurveAccountDecoded;
}





export class BondingCurveAccount {
    public discriminator: bigint;
    public virtualTokenReserves: bigint;
    public virtualSolReserves: bigint;
    public realTokenReserves: bigint;
    public realSolReserves: bigint;
    public tokenTotalSupply: bigint;
    public complete: boolean;

    constructor(
        discriminator: bigint,
        virtualTokenReserves: bigint,
        virtualSolReserves: bigint,
        realTokenReserves: bigint,
        realSolReserves: bigint,
        tokenTotalSupply: bigint,
        complete: boolean
    ) {
        this.discriminator = discriminator;
        this.virtualTokenReserves = virtualTokenReserves;
        this.virtualSolReserves = virtualSolReserves;
        this.realTokenReserves = realTokenReserves;
        this.realSolReserves = realSolReserves;
        this.tokenTotalSupply = tokenTotalSupply;
        this.complete = complete;
    }

    getBuyPrice(amount: bigint): bigint {
        if (this.complete) {
            throw new Error("Curve is complete");
        }

        if (amount <= 0n) {
            return 0n;
        }

        // Calculate the product of virtual reserves
        let n = this.virtualSolReserves * this.virtualTokenReserves;

        // Calculate the new virtual sol reserves after the purchase
        let i = this.virtualSolReserves + amount;

        // Calculate the new virtual token reserves after the purchase
        let r = n / i + 1n;

        // Calculate the amount of tokens to be purchased
        let s = this.virtualTokenReserves - r;

        // Return the minimum of the calculated tokens and real token reserves
        return s < this.realTokenReserves ? s : this.realTokenReserves;
    }

    getSellPrice(amount: bigint, feeBasisPoints: bigint): bigint {
        if (this.complete) {
            throw new Error("Curve is complete");
        }

        if (amount <= 0n) {
            return 0n;
        }

        // Calculate the proportional amount of virtual sol reserves to be received
        let n =
            (amount * this.virtualSolReserves) / (this.virtualTokenReserves + amount);

        // Calculate the fee amount in the same units
        let a = (n * feeBasisPoints) / 10000n;

        // Return the net amount after deducting the fee
        return n - a;
    }

    getMarketCapSOL(): bigint {
        if (this.virtualTokenReserves === 0n) {
            return 0n;
        }

        return (
            (this.tokenTotalSupply * this.virtualSolReserves) /
            this.virtualTokenReserves
        );
    }

    getFinalMarketCapSOL(feeBasisPoints: bigint): bigint {
        let totalSellValue = this.getBuyOutPrice(
            this.realTokenReserves,
            feeBasisPoints
        );
        let totalVirtualValue = this.virtualSolReserves + totalSellValue;
        let totalVirtualTokens = this.virtualTokenReserves - this.realTokenReserves;

        if (totalVirtualTokens === 0n) {
            return 0n;
        }

        return (this.tokenTotalSupply * totalVirtualValue) / totalVirtualTokens;
    }

    getBuyOutPrice(amount: bigint, feeBasisPoints: bigint): bigint {
        let solTokens =
            amount < this.realSolReserves ? this.realSolReserves : amount;
        let totalSellValue =
            (solTokens * this.virtualSolReserves) /
            (this.virtualTokenReserves - solTokens) +
            1n;
        let fee = (totalSellValue * feeBasisPoints) / 10000n;
        return totalSellValue + fee;
    }

    public static fromBuffer(buffer: Buffer): BondingCurveAccount {
        const structure: Layout<BondingCurveAccount> = struct([
            u64("discriminator"),
            u64("virtualTokenReserves"),
            u64("virtualSolReserves"),
            u64("realTokenReserves"),
            u64("realSolReserves"),
            u64("tokenTotalSupply"),
            bool("complete"),
        ]);

        let value = structure.decode(buffer);
        return new BondingCurveAccount(
            BigInt(value.discriminator),
            BigInt(value.virtualTokenReserves),
            BigInt(value.virtualSolReserves),
            BigInt(value.realTokenReserves),
            BigInt(value.realSolReserves),
            BigInt(value.tokenTotalSupply),
            value.complete
        );
    }
}

