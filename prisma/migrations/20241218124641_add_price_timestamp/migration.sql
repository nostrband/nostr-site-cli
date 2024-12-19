/*
  Warnings:

  - Added the required column `timestamp` to the `Prices` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Prices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL
);
INSERT INTO "new_Prices" ("amount", "group", "id", "period", "plan", "type", "unit") SELECT "amount", "group", "id", "period", "plan", "type", "unit" FROM "Prices";
DROP TABLE "Prices";
ALTER TABLE "new_Prices" RENAME TO "Prices";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
