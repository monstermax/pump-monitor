// promise.util.ts


/** Réessaye d'exécuter une fonction asynchrone jusqu'à ce qu'elle réussisse ou que le délai d'expiration soit atteint */
export async function retryAsync<T>(
    operation: () => Promise<T>,
    retryIntervalMs: number = 2000,
    timeoutMs: number = 60000,
    onRetry?: (attempt: number, elapsedMs: number) => void
): Promise<T> {
    const startTime = Date.now();
    let attempt = 0;

    while (true) {
        attempt++;
        try {
            return await operation();
        } catch (error) {
            const elapsedMs = Date.now() - startTime;

            // Vérifier si on a dépassé le timeout
            if (elapsedMs + retryIntervalMs >= timeoutMs) {
                throw new Error(`Opération échouée après ${attempt} tentatives (${elapsedMs}ms): ${error}`);
            }

            // Notifier de la nouvelle tentative
            if (onRetry) {
                onRetry(attempt, elapsedMs);
            }

            // Attendre avant de réessayer
            await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
        }
    }
}

