-- CreateTable
CREATE TABLE "Domain" (
    "domain" TEXT NOT NULL PRIMARY KEY,
    "site" TEXT,
    "status" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "expires" BIGINT NOT NULL,
    "pubkey" TEXT
);
