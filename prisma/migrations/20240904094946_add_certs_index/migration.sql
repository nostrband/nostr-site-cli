-- CreateIndex
CREATE INDEX "Certs_pubkey_domain_idx" ON "Certs"("pubkey", "domain");
