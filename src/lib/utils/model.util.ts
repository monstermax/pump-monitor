

export type SelectItemsOptions<T> = {
    sortCriteria?: keyof T; // Le champ sur lequel trier (ex: "createdAt")
    sortOrder?: 'asc' | 'desc'; // L'ordre de tri ('asc' pour ascendant, 'desc' pour descendant)
    limit?: number; // Nombre maximum de documents à retourner
    filter?: (item: T) => boolean; // Fonction de filtre qui retourne true pour les éléments à conserver
}



export function selectItems<T>(items: T[], findOptions: SelectItemsOptions<T> = {}): T[] {
    let result = [...items]; // Créer une copie pour ne pas modifier l'original

    // Filtre
    if (findOptions?.filter) {
        result = result.filter(findOptions.filter);
    }

    // Tri
    if (findOptions?.sortCriteria) {
        const sortOrder = findOptions?.sortOrder === 'asc' ? 'asc' : 'desc';

        result.sort((a, b) => {
            const valueA = a[findOptions.sortCriteria as keyof T];
            const valueB = b[findOptions.sortCriteria as keyof T];

            if (valueA < valueB) {
                return sortOrder === 'asc' ? -1 : 1;
            }
            if (valueA > valueB) {
                return sortOrder === 'asc' ? 1 : -1;
            }
            return 0;
        });
    }

    // Limit
    if (findOptions?.limit && findOptions.limit > 0) {
        result = result.slice(0, findOptions.limit);
    }

    return result;
}



