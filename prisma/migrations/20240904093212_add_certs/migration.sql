-- CreateTable
CREATE TABLE "Certs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL
);
