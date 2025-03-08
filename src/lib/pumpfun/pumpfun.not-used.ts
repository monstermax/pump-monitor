// pumpfun.not-used.ts

import { Commitment, Connection, Finality, Keypair, PublicKey, VersionedTransactionResponse, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, getAccount, getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { PUMPFUN_PROGRAM_ID } from "./pumpfun_create_buy_sell";
import { DEFAULT_COMMITMENT } from "./pumpfun_tx";

/* ######################################################### */


// Créez une fonction utilitaire pour détecter le type de programme Token
async function getTokenProgramId(connection: Connection, mint: PublicKey): Promise<PublicKey> {
    try {
        // Get account info first to check the owner
        const info = await connection.getAccountInfo(mint, "confirmed");

        if (!info) {
            console.warn(`⚠️ Aucune information de compte trouvée pour le mint: ${mint.toBase58()}`);
            return TOKEN_PROGRAM_ID; // Default to standard token program
        }

        console.log(`Propriétaire du compte mint: ${info.owner.toBase58()}`);

        // Vérifier si le token est un Token-2022
        if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
            console.log(`Token ${mint.toBase58()} is a Token-2022 token`);
            return TOKEN_2022_PROGRAM_ID;
        }

        // Vérifier si le token est un token SPL standard
        if (info.owner.equals(TOKEN_PROGRAM_ID)) {
            console.log(`Token ${mint.toBase58()} is a standard SPL token`);
            return TOKEN_PROGRAM_ID;
        }

        // Si le propriétaire n'est ni l'un ni l'autre, enregistrer un avertissement
        console.warn(`⚠️ Le token ${mint.toBase58()} a un propriétaire inattendu: ${info.owner.toBase58()}`);

        // Tenter de déterminer le bon programme en fonction du propriétaire
        if (info.owner.toString() === PUMPFUN_PROGRAM_ID) {
            console.log(`🚀 Le mint est détenu par le programme PumpFun, supposant TOKEN_PROGRAM_ID par défaut`);
            return TOKEN_PROGRAM_ID;
        }

        return TOKEN_PROGRAM_ID;

    } catch (err: any) {
        console.error(`❌ Erreur lors de l'obtention de l'ID du programme de token pour ${mint.toBase58()}:`, err);
        return TOKEN_PROGRAM_ID; // Default
    }
}




async function inferTokenProgram(
    connection: Connection,
    mint: PublicKey,
    commitment: Commitment = DEFAULT_COMMITMENT
): Promise<PublicKey> {
    try {
        // Récupération des infos du mint
        let mintInfo = await connection.getAccountInfo(mint, commitment);

        // Si pas d'info, essayons avec un commitment plus souple
        if (!mintInfo && commitment !== "confirmed") {
            console.log(`⚠️ Aucune information trouvée avec ${commitment}, on essaie avec 'confirmed'`);
            mintInfo = await connection.getAccountInfo(mint, "confirmed");
        }

        // Si toujours pas d'info, essayons avec "processed"
        if (!mintInfo) {
            console.log(`⚠️ Toujours pas d'information, on essaie avec 'processed'`);
            mintInfo = await connection.getAccountInfo(mint, "processed");
        }

        // Si nous avons des infos, on peut déterminer le programme
        if (mintInfo) {
            console.log(`✅ Information du mint trouvée, propriétaire: ${mintInfo.owner.toBase58()}`);

            // Vérifier si c'est un token Token-2022
            if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
                console.log(`🔄 Le token ${mint.toBase58()} est un token Token-2022`);
                return TOKEN_2022_PROGRAM_ID;
            }

            // Vérifier si c'est un token SPL standard
            if (mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
                console.log(`💱 Le token ${mint.toBase58()} est un token SPL standard`);
                return TOKEN_PROGRAM_ID;
            }

            // Propriétaire inconnu
            console.warn(`⚠️ Propriétaire de mint inconnu: ${mintInfo.owner.toBase58()}, on utilise TOKEN_PROGRAM_ID par défaut`);
            return TOKEN_PROGRAM_ID;
        }

        // Si nous n'avons pas pu obtenir d'information, observons si c'est un token pump.fun
        if (mint.toBase58().endsWith('pump')) {
            // Les tokens pump.fun récents utilisent généralement Token-2022
            console.log(`🚀 Token pump.fun détecté (${mint.toBase58()}), supposant TOKEN_2022_PROGRAM_ID`);
            return TOKEN_2022_PROGRAM_ID;
        }

        // Par défaut, utilisons le programme SPL standard
        console.log(`⚠️ Impossible de déterminer le programme de token, utilisation de TOKEN_PROGRAM_ID par défaut`);
        return TOKEN_PROGRAM_ID;

    } catch (err: any) {
        console.error(`❌ Erreur lors de la détection du programme de token:`, err);
        return TOKEN_PROGRAM_ID; // Par défaut
    }
}

