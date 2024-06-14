/*
  Warnings:

  - Added the required column `eventId` to the `EventQueue` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EventQueue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "domain" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL
);
INSERT INTO "new_EventQueue" ("domain", "id", "timestamp") SELECT "domain", "id", "timestamp" FROM "EventQueue";
DROP TABLE "EventQueue";
ALTER TABLE "new_EventQueue" RENAME TO "EventQueue";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
