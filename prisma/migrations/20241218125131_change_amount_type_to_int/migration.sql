/*
  Warnings:

  - You are about to alter the column `amount` on the `Invoices` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `amount` on the `Order` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.

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
    "paid_timestamp" BIGINT NOT NULL,
    "paid_order_id" TEXT NOT NULL
);
INSERT INTO "new_Invoices" ("amount", "id", "paid_order_id", "paid_timestamp", "price_id", "pubkey", "service_id", "timestamp", "unit") SELECT "amount", "id", "paid_order_id", "paid_timestamp", "price_id", "pubkey", "service_id", "timestamp", "unit" FROM "Invoices";
DROP TABLE "Invoices";
ALTER TABLE "new_Invoices" RENAME TO "Invoices";
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "invoice_ids" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "checkout_url" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "paid_timestamp" BIGINT NOT NULL
);
INSERT INTO "new_Order" ("amount", "checkout_url", "id", "invoice_ids", "paid_timestamp", "pubkey", "timestamp", "unit") SELECT "amount", "checkout_url", "id", "invoice_ids", "paid_timestamp", "pubkey", "timestamp", "unit" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
