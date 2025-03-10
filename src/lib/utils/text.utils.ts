// text.utils.ts


export function padCenter(str: string, maxLen: number) {
    return str.padStart((str.length + maxLen)/2).padEnd(maxLen);
}



