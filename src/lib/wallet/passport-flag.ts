/**
 * Drapeau de la connexion par wallet Bitcoin (Mezo Passport).
 *
 * Lu côté navigateur comme côté serveur : l'interface ne propose l'entrée que si le drapeau
 * est posé, et le serveur n'accepte les signatures de smart account (ERC-1271, ERC-6492)
 * que dans ce cas. Les deux lisent la même variable publique pour qu'une instance sans
 * Passport garde, au bit près, le comportement historique — vérification EOA pure, aucun
 * appel RPC pour vérifier une signature.
 *
 * Le runner lit la même variable : une délégation signée par un smart account doit être
 * acceptée là où elle est consommée, pas seulement là où elle est émise.
 *
 * Valeur exacte « true » : un « 1 » ou un « yes » laissé par mégarde n'active rien.
 */
export function mezoPassportEnabled(value: string | undefined = process.env.NEXT_PUBLIC_MEZO_PASSPORT): boolean {
  return value?.trim() === "true";
}
