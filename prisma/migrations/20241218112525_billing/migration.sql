-- CreateTable
CREATE TABLE "Prices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "group" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Services" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "price_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "paid_until" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "Invoices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "price_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "unit" TEXT NOT NULL,
    "paid_timestamp" BIGINT NOT NULL,
    "paid_order_id" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "invoice_ids" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "checkout_url" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "unit" TEXT NOT NULL,
    "paid_timestamp" BIGINT NOT NULL
);
