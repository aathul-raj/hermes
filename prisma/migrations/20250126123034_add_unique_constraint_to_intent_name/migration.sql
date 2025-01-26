/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Intent` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Intent_name_key" ON "Intent"("name");
