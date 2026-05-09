-- AlterTable
ALTER TABLE `DemoSession` ADD COLUMN `ghlLastSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `ghlLockerReadyTagAddedAt` DATETIME(3) NULL,
    ADD COLUMN `ghlOpportunityId` VARCHAR(191) NULL,
    ADD COLUMN `ghlSyncError` TEXT NULL,
    ADD COLUMN `ghlSyncStatus` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `GolfClient` ADD COLUMN `ghlLastSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `ghlSyncError` TEXT NULL,
    ADD COLUMN `ghlSyncStatus` VARCHAR(191) NULL;
