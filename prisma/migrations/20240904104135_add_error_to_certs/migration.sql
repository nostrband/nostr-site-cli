-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Certs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "error" TEXT NOT NULL DEFAULT ''
);
INSERT INTO "new_Certs" ("domain", "id", "pubkey", "timestamp") SELECT "domain", "id", "pubkey", "timestamp" FROM "Certs";
DROP TABLE "Certs";
ALTER TABLE "new_Certs" RENAME TO "Certs";
CREATE INDEX "Certs_domain_error_idx" ON "Certs"("domain", "error");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
