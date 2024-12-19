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
    "paid_timestamp" INTEGER NOT NULL DEFAULT 0,
    "paid_order_id" TEXT NOT NULL DEFAULT ''
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
    "paid_timestamp" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT ''
);
INSERT INTO "new_Orders" ("amount", "checkout_url", "id", "invoice_ids", "paid_timestamp", "pubkey", "timestamp", "unit") SELECT "amount", "checkout_url", "id", "invoice_ids", "paid_timestamp", "pubkey", "timestamp", "unit" FROM "Orders";
DROP TABLE "Orders";
ALTER TABLE "new_Orders" RENAME TO "Orders";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
