
import { Connection } from "@solana/web3.js";

import { appConfig } from "./env";

/* ######################################################### */


async function main() {
    const rpcsList: Record<string, string> = appConfig.solana.rpc;

    const promises = Object.entries(rpcsList).map(entry => {
        const rpcName = entry[0];
        const rpcUrl = entry[1];
        const tsStart = Date.now();

        const promise = async () => {
            const connection = new Connection(rpcUrl);
            const result = await connection.getSlot();
            //const result = await connection.getLatestBlockhash();
            const duration = (Date.now() - tsStart)/1000;

            return [
                rpcName,
                {
                    //rpcUrl,
                    result,
                    duration,
                },
            ]
        };

        return promise()
            .catch((err: any) => {
                const duration = (Date.now() - tsStart)/1000;
                //console.warn(`Erreur sur le RPC ${rpcName}. ${err.message}`);

                return [
                    rpcName,
                    {
                        error: err.message,
                        duration,
                    },
                ];
            });
    });

    const results = await Promise.all(promises);

    console.log('results:', Object.fromEntries(results))
}


main();

