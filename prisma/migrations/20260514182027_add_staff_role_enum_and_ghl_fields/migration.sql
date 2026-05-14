/*
  Warnings:

  - You are about to alter the column `role` on the `StaffUser` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(0))`.
  - A unique constraint covering the columns `[ghlContactId]` on the table `StaffUser` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `StaffUser` ADD COLUMN `ghlContactId` VARCHAR(191) NULL,
    ADD COLUMN `ghlLastSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `ghlSyncError` TEXT NULL,
    ADD COLUMN `ghlSyncStatus` VARCHAR(191) NULL,
    MODIFY `role` ENUM('admin', 'sales_rep', 'support') NOT NULL DEFAULT 'sales_rep';

-- CreateIndex
CREATE UNIQUE INDEX `StaffUser_ghlContactId_key` ON `StaffUser`(`ghlContactId`);
