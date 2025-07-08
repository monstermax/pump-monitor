
declare module "human-time" {
  /**
   * Convertit une date, un timestamp ou un objet Date en une chaîne lisible indiquant le temps écoulé depuis une date donnée.
   *
   * @param date - Une instance de Date, un timestamp ou une chaîne de texte représentant une date.
   * @returns Une chaîne de caractères représentant le temps écoulé depuis la date passée.
   */
  function humanTime(date: Date | string | number): string;

  export = humanTime;
}
