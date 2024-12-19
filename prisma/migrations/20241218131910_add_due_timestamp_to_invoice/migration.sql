/*
  Warnings:

  - Added the required column `due_timestamp` to the `Invoices` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "price_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "due_timestamp" BIGINT NOT NULL,
    "paid_timestamp" BIGINT NOT NULL,
    "paid_order_id" TEXT NOT NULL
);
INSERT INTO "new_Invoices" ("amount", "id", "paid_order_id", "paid_timestamp", "price_id", "pubkey", "service_id", "timestamp", "unit") SELECT "amount", "id", "paid_order_id", "paid_timestamp", "price_id", "pubkey", "service_id", "timestamp", "unit" FROM "Invoices";
DROP TABLE "Invoices";
ALTER TABLE "new_Invoices" RENAME TO "Invoices";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
