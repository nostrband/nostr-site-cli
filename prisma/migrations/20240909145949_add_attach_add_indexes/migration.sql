-- CreateTable
CREATE TABLE "Attach" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pubkey" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Attach_pubkey_site_domain_key" ON "Attach"("pubkey", "site", "domain");

-- CreateIndex
CREATE INDEX "Domain_pubkey_idx" ON "Domain"("pubkey");

-- CreateIndex
CREATE INDEX "Domain_site_idx" ON "Domain"("site");
