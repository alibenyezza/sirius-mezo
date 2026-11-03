/**
 * Interrupteurs des intégrations Mezo, lus dans l'environnement du serveur.
 *
 * Chacune de ces fonctions fait dépenser du gas à un compte de Sirius ou envoie l'acheteur
 * vers un contrat du protocole MUSD : elles s'activent explicitement, instance par instance.
 */
export interface MezoFeatures {
  /** `SiriusEscrow.lockWithSignature` relayé par le compte de règlement (permit MUSD + EIP-712). */
  gaslessLock: boolean;
  /** Tirage de MUSD sur le trove de l'acheteur via `BorrowerOperationsSignatures`. */
  borrowAndBuy: boolean;
  /** Dépôt des gains dans le Stability Pool ou le coffre sMUSD depuis le wallet. */
  earn: boolean;
  /** Paiement en BTC : `SiriusCheckout` échange sur Mezo Pools et verrouille en une transaction. */
  payWithBtc: boolean;
}

export function mezoFeatures(env: Record<string, string | undefined> = process.env): MezoFeatures {
  const on = (name: string) => env[name]?.trim() === "true";
  return {
    gaslessLock: on("SIRIUS_GASLESS_LOCK"),
    borrowAndBuy: on("SIRIUS_BORROW_AND_BUY"),
    earn: on("SIRIUS_MEZO_EARN"),
    payWithBtc: on("SIRIUS_PAY_WITH_BTC") && Boolean((env.SIRIUS_CHECKOUT_ADDRESS ?? env.NEXT_PUBLIC_SIRIUS_CHECKOUT_ADDRESS)?.trim()),
  };
}
