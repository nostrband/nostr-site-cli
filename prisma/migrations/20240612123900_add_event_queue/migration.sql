-- CreateTable
CREATE TABLE "EventQueue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "domain" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Domain" (
    "domain" TEXT NOT NULL PRIMARY KEY,
    "site" TEXT,
    "status" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "expires" BIGINT NOT NULL,
    "pubkey" TEXT,
    "rendered" BIGINT NOT NULL DEFAULT 0,
    "updated" BIGINT NOT NULL DEFAULT 0
);
INSERT INTO "new_Domain" ("domain", "expires", "pubkey", "rendered", "site", "status", "timestamp") SELECT "domain", "expires", "pubkey", "rendered", "site", "status", "timestamp" FROM "Domain";
DROP TABLE "Domain";
ALTER TABLE "new_Domain" RENAME TO "Domain";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
