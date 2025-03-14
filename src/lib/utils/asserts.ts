// asserts.ts


export function asserts(condition: unknown, message?: string): asserts condition {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

