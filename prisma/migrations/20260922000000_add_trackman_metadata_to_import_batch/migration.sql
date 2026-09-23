-- AlterTable
ALTER TABLE `ImportBatch`
  ADD COLUMN `trackmanSessionId` VARCHAR(191) NULL,
  ADD COLUMN `trackmanPlayerId` VARCHAR(191) NULL,
  ADD COLUMN `trackmanPlayerName` VARCHAR(191) NULL,
  ADD COLUMN `trackmanPlayerEmail` VARCHAR(191) NULL,
  ADD COLUMN `trackmanSessionDate` DATETIME(3) NULL,
  ADD COLUMN `trackmanMetadataError` TEXT NULL;