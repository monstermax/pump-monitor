// time.utils.ts


export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function getUsDate(date?: Date) {
    if (date === null) return '';
    date = date ?? new Date;
    return date.toLocaleDateString('fr-FR', { dateStyle: 'short' }).split('/').reverse().join('-');
}


export function getUsDateTime(date?: Date) {
    if (date === null) return '';
    date = date ?? new Date;
    return `${getUsDate(date)} ${date.toLocaleTimeString('fr-FR', { timeStyle: 'medium' })}`;
}


