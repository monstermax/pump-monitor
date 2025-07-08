// console.ts

import { getTime } from "./time.util";


export function log(...args: any[]) {
    args.unshift(...[now(), '|']);
    console.log(...args)
}

export function warn(...args: any[]) {
    args.unshift(...[now(), '|']);
    console.warn(...args)
}

export function error(...args: any[]) {
    args.unshift(...[now(), '|']);
    console.error(...args)
}


export function now(date?: Date) {
    return getTime(date);
    //return (date ?? new Date).toLocaleTimeString('fr-FR', { timeStyle: 'medium', second: 'numeric' });
    //return (date ?? new Date).toISOString()
    //    .replace('Z', '')
    //    .replace('T', ' ');
}

