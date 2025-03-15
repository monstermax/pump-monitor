// pumpfun_sell.ts

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { DEFAULT_DECIMALS, FEE_RECIPIENT, PUMPFUN_PROGRAM_ID } from "../pumpfun_config";
import { getBondingCurvePDA } from "../pumpfun_bondingcurve_account";
import { getPriorityFee } from "../../solana/solana_tx_tools";
import { getOnChainTokenPrice } from "../pumpfun_trading";

/* ######################################################### */

type Token = { 
    mint: PublicKey,
    bonding_curve?: PublicKey,
    associated_bonding_curve?: PublicKey,
}


/* ######################################################### */

const PUMP_GLOBAL = new PublicKey(process.env.PUMP_GLOBAL ?? '');
const PUMP_EVENT_AUTHORITY = new PublicKey(process.env.PUMP_EVENT_AUTHORITY ?? '');
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");


// Liste des comptes Jito Tip
const jitoTipAccounts = [
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49"
];


/* ######################################################### */



export async function pumpFunSell(connection: Connection, jitoConnection: Connection | null, wallet: Keypair, token: Token, tokenAmount: number, slippage = 0.5, tipAmount = 0.0005) {
    try {
        // console.log(`Vente de ${tokenMint} pour ${amountSol} SOL`);

        let {mint, bonding_curve, associated_bonding_curve } = token;

        if (!bonding_curve || !associated_bonding_curve) {
            if (! bonding_curve) {
                bonding_curve = getBondingCurvePDA(mint);
            }

            if (! associated_bonding_curve) {
                associated_bonding_curve = await getAssociatedTokenAddress(
                    mint,
                    bonding_curve,
                    true,
                    TOKEN_PROGRAM_ID // Toujours standard SPL pour la bonding curve
                );
            }
        }

        const associatedTokenAccount = await getAssociatedTokenAddress(mint, wallet.publicKey, false, TOKEN_PROGRAM_ID);

        // Récupération du dernier blockhash
        console.log("Récupération du dernier blockhash...");
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const priorityFee = await getPriorityFee(connection);

        // Récupération des détails du token pour calculer la vente
        const tokenPriceSol = await getOnChainTokenPrice(connection, new PublicKey(bonding_curve));
        console.log(`PREMIER PRIX CALCULE POUR LANCER LA VENTE ${tokenPriceSol?.toFixed(10)}`);
        if (!tokenPriceSol) throw new Error("tokenPriceSol invalide")

        const solAmount = tokenAmount * tokenPriceSol;
        const amountLamports = Math.ceil(solAmount * DEFAULT_DECIMALS);
        const maxAmountLamports = Math.ceil(amountLamports * (1 + (slippage/100)));

        // Création des buffers pour la vente
        const discriminator = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

        const tokenAmountBuffer = Buffer.alloc(8);
        tokenAmountBuffer.writeBigUInt64LE(BigInt(Math.floor(tokenAmount * 10 ** DEFAULT_DECIMALS)));

        const solAmountBuffer = Buffer.alloc(8);
        solAmountBuffer.writeBigUInt64LE(BigInt(maxAmountLamports));

        // Création de la transaction de vente
        const data = Buffer.concat([discriminator, tokenAmountBuffer, solAmountBuffer]);

        const accounts = [
            { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
            { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
            { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
            { pubkey: new PublicKey(bonding_curve), isSigner: false, isWritable: true },
            { pubkey: new PublicKey(associated_bonding_curve), isSigner: false, isWritable: true },
            { pubkey: associatedTokenAccount, isSigner: false, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
            { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
            { pubkey: new PublicKey(PUMPFUN_PROGRAM_ID), isSigner: false, isWritable: false },
        ];

        const sellInstruction = new TransactionInstruction({
            keys: accounts,
            programId: new PublicKey(PUMPFUN_PROGRAM_ID),
            data: data,
        });


        // Création de la transaction unique avec toutes les étapes en une seule TX
        console.log("Construction de la transaction MEV...");

        let transaction: Transaction & { feeCalculator?: { priorityFeeLamports: number } } = new Transaction();

        if (jitoConnection) {
            // Sélectionner un compte Tip Jito random
            const randomTipAccount = new PublicKey(jitoTipAccounts[Math.floor(Math.random() * jitoTipAccounts.length)]);

            // Instruction pour Tip Jito
            const tipInstruction = SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey: randomTipAccount,
                lamports: tipAmount * LAMPORTS_PER_SOL,
            });

            transaction.add(tipInstruction) // Tip Jito pour inclusion ultra-rapide

        } else {
            transaction.add(
                ComputeBudgetProgram.setComputeUnitLimit({
                    units: 1_000_000 // priorityFees.unitLimit
                })
            );

            transaction.add(
                ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: 100 // priorityFees.unitPrice
                })
            );
        }

        transaction.add(sellInstruction); // Vente

        transaction.recentBlockhash = blockhash;
        transaction.feePayer = wallet.publicKey;
        transaction.feeCalculator = { priorityFeeLamports: priorityFee };
        transaction.sign(wallet);

        // Envoi de la transaction
        console.log(`Envoi de la transaction ${jitoConnection ? `(avec Jito) ` : ''}...`);
        const signature = await (jitoConnection ?? connection).sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            preflightCommitment: "processed",
        });

        console.log(`Vente envoyée ${jitoConnection ? `(avec Jito) ` : ''}: https://solscan.io/tx/${signature}`);
        return signature;

    } catch (err: any) {
        console.error(`Erreur lors de la vente: ${err.message}`);
    }
}

