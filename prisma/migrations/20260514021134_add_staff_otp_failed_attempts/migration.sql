-- AlterTable
ALTER TABLE `StaffOtp` ADD COLUMN `failedAttempts` INTEGER NOT NULL DEFAULT 0;
