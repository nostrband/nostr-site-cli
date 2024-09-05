-- DropIndex
DROP INDEX "Certs_pubkey_domain_idx";

-- CreateIndex
CREATE INDEX "Certs_domain_idx" ON "Certs"("domain");
