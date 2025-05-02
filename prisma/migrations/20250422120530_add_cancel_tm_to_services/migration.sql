-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Services" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "price_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "paid_until" INTEGER NOT NULL,
    "cancel_tm" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_Services" ("id", "object_id", "paid_until", "price_id", "pubkey", "timestamp") SELECT "id", "object_id", "paid_until", "price_id", "pubkey", "timestamp" FROM "Services";
DROP TABLE "Services";
ALTER TABLE "new_Services" RENAME TO "Services";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
