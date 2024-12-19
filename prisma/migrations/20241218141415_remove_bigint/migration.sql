/*
  Warnings:

  - You are about to alter the column `due_timestamp` on the `Invoices` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `paid_timestamp` on the `Invoices` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `timestamp` on the `Invoices` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `paid_timestamp` on the `Orders` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `timestamp` on the `Orders` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `timestamp` on the `Prices` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `paid_until` on the `Services` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `timestamp` on the `Services` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "price_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "due_timestamp" INTEGER NOT NULL,
    "paid_timestamp" INTEGER NOT NULL,
    "paid_order_id" TEXT NOT NULL
);
INSERT INTO "new_Invoices" ("amount", "due_timestamp", "id", "paid_order_id", "paid_timestamp", "price_id", "pubkey", "service_id", "timestamp", "unit") SELECT "amount", "due_timestamp", "id", "paid_order_id", "paid_timestamp", "price_id", "pubkey", "service_id", "timestamp", "unit" FROM "Invoices";
DROP TABLE "Invoices";
ALTER TABLE "new_Invoices" RENAME TO "Invoices";
CREATE TABLE "new_Orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "invoice_ids" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "checkout_url" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "paid_timestamp" INTEGER NOT NULL
);
INSERT INTO "new_Orders" ("amount", "checkout_url", "id", "invoice_ids", "paid_timestamp", "pubkey", "timestamp", "unit") SELECT "amount", "checkout_url", "id", "invoice_ids", "paid_timestamp", "pubkey", "timestamp", "unit" FROM "Orders";
DROP TABLE "Orders";
ALTER TABLE "new_Orders" RENAME TO "Orders";
CREATE TABLE "new_Prices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL
);
INSERT INTO "new_Prices" ("amount", "group", "id", "period", "plan", "timestamp", "type", "unit") SELECT "amount", "group", "id", "period", "plan", "timestamp", "type", "unit" FROM "Prices";
DROP TABLE "Prices";
ALTER TABLE "new_Prices" RENAME TO "Prices";
CREATE TABLE "new_Services" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "price_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "paid_until" INTEGER NOT NULL
);
INSERT INTO "new_Services" ("id", "object_id", "paid_until", "price_id", "pubkey", "timestamp") SELECT "id", "object_id", "paid_until", "price_id", "pubkey", "timestamp" FROM "Services";
DROP TABLE "Services";
ALTER TABLE "new_Services" RENAME TO "Services";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
