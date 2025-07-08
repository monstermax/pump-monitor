
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';


import { PUMPFUN_PROGRAM_ID } from "../pumpfun_config";


// https://github.com/pump-fun/pump-public-docs
// https://deepwiki.com/pump-fun/pump-public-docs/4.2-pumpswap-creator-fee-implementation


export async function getVaultCreatorPubkey(connection: Connection, tokenPubkey: PublicKey): Promise<PublicKey | null> {
    const creatorPubkey = await getCreatorFromToken(connection, tokenPubkey);
    console.log('creatorPubkey:', creatorPubkey?.toBase58())

    //const creatorPubkey = new PublicKey('81jz8Jvc2cZCS73nEMMFvFhPdiUHSCCmc3NQ3cnqpJ3E'); // creator

    if (creatorPubkey) {
        const vaultPubkey = await getCreatorVaultAddress(creatorPubkey);
        //console.log('vaultPubkey:', vaultPubkey?.toBase58())
        return vaultPubkey;
    }

    return null;
}


export function getCreatorVaultAddress(creatorPubkey: PublicKey): PublicKey {
    const [creatorVault] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("creator-vault"),
            creatorPubkey.toBuffer()
        ],
        new PublicKey(PUMPFUN_PROGRAM_ID)
    );

    return creatorVault;
}


export async function getCreatorFromToken(connection: any, mintAddress: PublicKey): Promise<PublicKey | null> {
    try {
        // 1. Dériver l'adresse de la bonding curve
        const [bondingCurve] = PublicKey.findProgramAddressSync(
            [Buffer.from("bonding-curve"), mintAddress.toBuffer()],
            new PublicKey(PUMPFUN_PROGRAM_ID)
        );

        //console.log('bondingCurve:', bondingCurve.toBase58())

        // 2. Lire les données de la bonding curve
        const accountInfo = await connection.getAccountInfo(bondingCurve);
        if (!accountInfo || accountInfo.data.length < 73) return null;

        const creatorBytes = accountInfo.data.slice(8 + 41, 8 + 73);
        const creatorAddress = new PublicKey(creatorBytes);

        return creatorAddress;

    } catch (error) {
        console.error("Erreur lors de la lecture du créateur:", error);
        return null;
    }
}



export async function getTokenBalance(connection: Connection, walletAddress: string, tokenMintAddress: string): Promise<number> {
    try {
        const walletPublicKey = new PublicKey(walletAddress);
        const tokenMintPublicKey = new PublicKey(tokenMintAddress);

        // Obtenir l'adresse du compte de token associé
        const associatedTokenAddress = await getAssociatedTokenAddress(
            tokenMintPublicKey,
            walletPublicKey
        );

        // Récupérer les informations du compte
        const tokenAccount = await getAccount(connection, associatedTokenAddress);

        // Le solde est en unités de base (plus petite unité du token)
        // Pour la plupart des tokens, il faut diviser par 10^decimals
        const balance = Number(tokenAccount.amount);

        return balance;
    } catch (error) {
        console.error('Erreur lors de la récupération du solde:', error);

        // Si le compte n'existe pas, le solde est 0
        if (error instanceof Error && error.message.includes('could not find account')) {
            return 0;
        }

        throw error;
    }
}

// Fonction pour obtenir le solde formaté avec les décimales
export async function getFormattedTokenBalance(connection: Connection, walletAddress: string, tokenMintAddress: string): Promise<number> {
    try {
        const balance = await getTokenBalance(connection, walletAddress, tokenMintAddress);

        // Récupérer les informations du token pour connaître le nombre de décimales
        const tokenMintPublicKey = new PublicKey(tokenMintAddress);
        const mintInfo = await connection.getParsedAccountInfo(tokenMintPublicKey);

        if (!mintInfo.value || !mintInfo.value.data || typeof mintInfo.value.data !== 'object' || !('parsed' in mintInfo.value.data)) {
            throw new Error('Impossible de récupérer les informations du token');
        }

        const decimals = mintInfo.value.data.parsed.info.decimals;
        const formattedBalance = balance / Math.pow(10, decimals);

        return formattedBalance;

    } catch (error) {
        console.error('Erreur lors du formatage du solde:', error);
        throw error;
    }
}

