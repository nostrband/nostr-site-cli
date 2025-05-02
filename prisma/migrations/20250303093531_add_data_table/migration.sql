-- CreateTable
CREATE TABLE "Data" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pubkey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Data_pubkey_key_key" ON "Data"("pubkey", "key");
