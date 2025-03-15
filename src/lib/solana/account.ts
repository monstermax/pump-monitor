
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { AccountLayout } from "@solana/spl-token";



// Méthode pour obtenir le solde d'un token
export async function getTokenBalance(connection: Connection, wallet: Keypair, tokenAddress: string, minContextSlot?: number): Promise<bigint> {

    // TODO: implémenter un retry (si minContextSlot est fourni)

    try {
        // Créer l'adresse du compte de token associé
        const tokenMint = new PublicKey(tokenAddress);
        const associatedTokenAddress = await getAssociatedTokenAddress(tokenMint, wallet.publicKey);

        // Vérifier si le compte existe
        const tokenAccountInfo = await connection.getAccountInfo(associatedTokenAddress, { minContextSlot });

        if (!tokenAccountInfo) {
            return 0n; // Le compte n'existe pas, donc le solde est 0
        }

        // Parser les données du compte pour obtenir le solde
        const tokenAccount = AccountLayout.decode(tokenAccountInfo.data);
        const amount = tokenAccount.amount;

        return amount;

    } catch (err: any) {
        console.error(`Error getting token balance for ${tokenAddress}:`, err);
        return 0n;
    }
}



export const formatAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};
