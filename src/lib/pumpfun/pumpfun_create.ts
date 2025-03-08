// pumpfun_create.ts

import { Commitment, Connection, Finality, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";

import { PriorityFee, TransactionResult } from "../../services/Trading.service";
import { calculateWithSlippageBuy, CreateTokenMetadata, FEE_RECIPIENT, METADATA_SEED } from "./pumpfun_create_buy_sell";
import { getBuyInstructions } from "./pumpfun_buy";
import { DEFAULT_COMMITMENT, DEFAULT_FINALITY, sendTx } from "./pumpfun_tx";
import { getGlobalAccount } from "./pumpfun_global_account";
import { getBondingCurvePDA } from "./pumpfun_bondingcurve_account";


/* ######################################################### */


export async function pumpFunCreateAndBuy(
    connection: Connection,
    creator: Keypair,
    mint: Keypair,
    newTokenMetadata: CreateTokenMetadata,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY
): Promise<TransactionResult> {
    let tokenMetadata = await createTokenMetadata(newTokenMetadata);

    let createTx = await getCreateInstructions(
        connection,
        creator.publicKey,
        newTokenMetadata.name,
        newTokenMetadata.symbol,
        tokenMetadata.metadataUri,
        mint
    );

    let newTx = new Transaction().add(createTx);

    if (buyAmountSol > 0) {
        const globalAccount = await getGlobalAccount(connection, commitment);
        const buyAmount = globalAccount.getInitialBuyPrice(buyAmountSol);
        const buyAmountWithSlippage = calculateWithSlippageBuy(
            buyAmountSol,
            slippageBasisPoints
        );

        const buyTx = await getBuyInstructions(
            connection,
            creator.publicKey,
            mint.publicKey,
            FEE_RECIPIENT /*globalAccount.feeRecipient */,
            buyAmount,
            buyAmountWithSlippage
        );

        newTx.add(buyTx);
    }

    let createResults = await sendTx(
        connection,
        newTx,
        creator.publicKey,
        [creator, mint],
        priorityFees,
        commitment,
        finality
    );
    return createResults;
}




//create token instructions
async function getCreateInstructions(
    connection: Connection,
    creator: PublicKey,
    name: string,
    symbol: string,
    uri: string,
    mint: Keypair,
    commitment: Commitment = DEFAULT_COMMITMENT
) {
    // Inférer le programme de token pour ce mint
    const tokenProgramId = TOKEN_2022_PROGRAM_ID; //await inferTokenProgram(connection, mint, commitment);

    const mplTokenMetadata = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID);

    const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from(METADATA_SEED),
            mplTokenMetadata.toBuffer(),
            mint.publicKey.toBuffer(),
        ],
        mplTokenMetadata
    );

    const associatedBondingCurve = await getAssociatedTokenAddress(
        mint.publicKey,
        getBondingCurvePDA(mint.publicKey),
        true
    );



    //const globalAccount = await getGlobalAccount(connection, commitment);
    //const globalAccountPubKey = globalAccount.feeRecipient;
    const globalAccountPubKey = FEE_RECIPIENT; //getGlobalAccountPubKey();


    // Créer l'instruction manuellement avec les bons programmes
    const createInstruction = preparePumpFunCreateInstruction(
        globalAccountPubKey,
        mint,
        associatedBondingCurve,
        creator,
        metadataPDA,
        name,
        symbol,
        uri,
        tokenProgramId // Passer le programme de token détecté
    );

    //const createInstruction = program.methods
    //    .create(name, symbol, uri)
    //    .accounts({
    //        mint: mint.publicKey,
    //        associatedBondingCurve: associatedBondingCurve,
    //        metadata: metadataPDA,
    //        user: creator,
    //    })
    //    .signers([mint])
    //    .transaction()

    return createInstruction;
}




export function preparePumpFunCreateInstruction(
    feeRecipient: PublicKey,
    mint: Keypair,
    associatedBondingCurve: PublicKey,
    creator: PublicKey,
    metadataPDA: PublicKey,
    name: string,
    symbol: string,
    uri: string,
    tokenProgramId: PublicKey = TOKEN_PROGRAM_ID
): TransactionInstruction {

    throw new Error(`preparePumpFunCreateInstruction not implemented`);

}



export async function createTokenMetadata(create: CreateTokenMetadata) {
    // Validate file
    if (!(create.file instanceof Blob)) {
        throw new Error('File must be a Blob or File object');
    }

    let formData = new FormData();
    formData.append("file", create.file, 'image.png'); // Add filename
    formData.append("name", create.name);
    formData.append("symbol", create.symbol);
    formData.append("description", create.description);
    formData.append("twitter", create.twitter || "");
    formData.append("telegram", create.telegram || "");
    formData.append("website", create.website || "");
    formData.append("showName", "true");

    try {
        const request = await fetch("https://pump.fun/api/ipfs", {
            method: "POST",
            headers: {
                'Accept': 'application/json',
            },
            body: formData,
            credentials: 'same-origin'
        });

        if (request.status === 500) {
            // Try to get more error details
            const errorText = await request.text();
            throw new Error(`Server error (500): ${errorText || 'No error details available'}`);
        }

        if (!request.ok) {
            throw new Error(`HTTP error! status: ${request.status}`);
        }

        const responseText = await request.text();
        if (!responseText) {
            throw new Error('Empty response received from server');
        }

        try {
            return JSON.parse(responseText);
        } catch (e) {
            throw new Error(`Invalid JSON response: ${responseText}`);
        }

    } catch (err: any) {
        console.error('Error in createTokenMetadata:', err);
        throw err;
    }
}

