-- Reçu d'exécution hors enclave : signature EIP-191 du hash attesté par le compte de règlement,
-- vérifiable par quiconque contre le lockAuthorizer immuable de l'escrow.
ALTER TABLE "Loan" ADD COLUMN "attestationSignature" TEXT;
