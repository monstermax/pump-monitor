// solana_token_cleanup.ts

import { Connection, PublicKey, Transaction, sendAndConfirmTransaction, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createCloseAccountInstruction } from '@solana/spl-token';
import bs58 from 'bs58';



/** Récupère la liste des comptes de token avec balance à 0 */
export async function getEmptyTokenAccounts(
    connection: Connection,
    walletPublicKey: PublicKey
): Promise<{ accountAddress: PublicKey, mint: PublicKey }[]> {

    console.log(`Recherche des comptes de token vides pour: ${walletPublicKey.toBase58()}`);

    // Récupérer tous les comptes de token associés au wallet
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        walletPublicKey,
        { programId: TOKEN_PROGRAM_ID }
    );

    console.log(`${tokenAccounts.value.length} comptes de token trouvés au total`);


    // Filtrer pour ne garder que les comptes avec une balance à 0
    const emptyAccounts = tokenAccounts.value
        .filter(account => {
            const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
            return amount === 0;
        })
        .map(account => ({
            accountAddress: new PublicKey(account.pubkey.toBase58()),
            mint: new PublicKey(account.account.data.parsed.info.mint)
        }));

    console.log(`${emptyAccounts.length} comptes vides trouvés`);

    return emptyAccounts;
}



/** Crée et envoie un bundle Jito pour fermer tous les comptes de token vides */
export async function closeEmptyTokenAccountsWithJitoBundle(
    connection: Connection,
    wallet: Keypair,
    emptyAccounts: { accountAddress: PublicKey, mint: PublicKey }[]
): Promise<string> {

    if (emptyAccounts.length === 0) {
        console.log("Aucun compte vide à fermer");
        return "";
    }


    // Créer une seule transaction avec toutes les instructions
    const transaction = new Transaction();

    // Ajouter les instructions pour fermer chaque compte vide
    for (const { accountAddress } of emptyAccounts) {
        transaction.add(
            createCloseAccountInstruction(
                accountAddress,
                wallet.publicKey,  // destination
                wallet.publicKey,  // authority
                [],                // multiSigners
                TOKEN_PROGRAM_ID
              )
        );
    }

    // Configurer les options Jito (vous devrez ajuster en fonction de l'API Jito)
    const jitoOptions = {
        skipPreflight: true,
        maxRetries: 3
    };

    try {
        // Envoyer la transaction comme un bundle Jito
        // Note: L'implémentation exacte dépendra de l'API Jito que vous utilisez
        // Voici une version simplifiée qui utilise sendAndConfirmTransaction standard

        // Pour un vrai bundle Jito, vous devrez utiliser leur API spécifique ici
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [wallet],
            jitoOptions
        );

        console.log(`Bundle envoyé avec succès. Signature: ${signature}`);
        console.log(`Environ ${(emptyAccounts.length * 0.00203928).toFixed(8)} SOL récupérés`);

        return signature;

    } catch (err: any) {
        console.error("Erreur lors de l'envoi du bundle Jito:", err);
        throw err;
    }
}



export async function cleanupEmptyTokenAccounts(
    connection: Connection,
    walletSecretKey: string
): Promise<void> {

    // Créer le keypair à partir de la clé privée
    const wallet = Keypair.fromSecretKey(bs58.decode(walletSecretKey));

    // Récupérer les comptes vides
    const emptyAccounts = await getEmptyTokenAccounts(connection, wallet.publicKey);

    // Si des comptes vides ont été trouvés, les fermer avec un bundle Jito
    if (emptyAccounts.length > 0) {
        await closeEmptyTokenAccountsWithJitoBundle(connection, wallet, emptyAccounts);
    }
}



// Exemple d'usage
/*
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const privateKey = 'VOTRE_CLE_PRIVEE_EN_BASE58';

cleanupEmptyTokenAccounts(connection, privateKey)
  .then(() => console.log('Nettoyage terminé'))
  .catch(error => console.error('Erreur:', error));
*/

