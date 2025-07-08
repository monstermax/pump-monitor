// promise.util.ts

import { sleep } from "./time.util";


/** Réessaye d'exécuter une fonction asynchrone jusqu'à ce qu'elle réussisse ou que le délai d'expiration soit atteint */
export async function retryAsync<T>(
    operation: () => Promise<T>,
    retryIntervalMs: number = 2000,
    timeoutMs: number = 60000,
    onRetry?: (attempt: number, elapsedMs: number, retryIntervalMs: number) => void,
    resultChecker?: (result: any) => boolean
): Promise<T> {
    const startTime = Date.now();
    let attempt = 0;

    while (true) {
        attempt++;

        try {
            return await operation()
                .then((result: T) => {
                    if (resultChecker && ! resultChecker(result)) throw new Error(`Résultat non valide`);
                    return result;
                });

        } catch (err: any) {
            const elapsedMs = Date.now() - startTime;

            // Vérifier si on a dépassé le timeout
            if (elapsedMs + retryIntervalMs >= timeoutMs) {
                throw new Error(`Opération échouée après ${attempt} tentatives (${elapsedMs}ms): ${err}`);
            }

            // Notifier de la nouvelle tentative
            if (onRetry) {
                onRetry(attempt, elapsedMs, retryIntervalMs);
            }

            // Attendre avant de réessayer
            await sleep(retryIntervalMs)
        }
    }
}

