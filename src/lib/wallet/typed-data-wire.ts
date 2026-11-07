import { getTypesForEIP712Domain, serializeTypedData, type TypedDataDomain } from "viem";

/**
 * JSON d'un `eth_signTypedData_v4`, construit comme viem le fait dans `signTypedData`
 * (types du domaine ajoutés, puis `serializeTypedData`).
 *
 * Sans `types.EIP712Domain`, MetaMask hache le domaine comme une structure vide : la
 * signature ne correspond plus au digest que vérifie le contrat (`InvalidBorrowerSignature`,
 * tirage sur trove refusé). Les entiers sortent en chaînes décimales, bigint ou non.
 */
export function typedDataJsonForWallet(payload: unknown): string {
  const typed = payload as { domain?: TypedDataDomain; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> };
  const types = "EIP712Domain" in typed.types
    ? typed.types
    : { EIP712Domain: getTypesForEIP712Domain({ domain: typed.domain }), ...typed.types };
  return serializeTypedData({ ...typed, types } as never);
}
