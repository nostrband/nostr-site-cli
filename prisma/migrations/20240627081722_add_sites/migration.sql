-- CreateTable
CREATE TABLE "Sites" (
    "d_tag" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Sites_pubkey_idx" ON "Sites"("pubkey");
