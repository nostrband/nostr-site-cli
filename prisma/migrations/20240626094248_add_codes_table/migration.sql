-- CreateTable
CREATE TABLE "Codes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "npub" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL
);
