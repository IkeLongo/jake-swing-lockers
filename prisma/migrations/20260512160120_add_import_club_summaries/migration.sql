-- CreateTable
CREATE TABLE `ImportClubSummary` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `importBatchId` INTEGER NOT NULL,
    `originalClubName` VARCHAR(191) NULL,
    `clubName` VARCHAR(191) NOT NULL,
    `shotCount` INTEGER NOT NULL,
    `avgClubSpeed` DECIMAL(6, 2) NULL,
    `avgBallSpeed` DECIMAL(6, 2) NULL,
    `avgSpinRate` DECIMAL(8, 2) NULL,
    `avgMaxHeight` DECIMAL(6, 2) NULL,
    `avgCarry` DECIMAL(6, 2) NULL,
    `avgTotal` DECIMAL(6, 2) NULL,
    `validClubSpeedCount` INTEGER NOT NULL DEFAULT 0,
    `validBallSpeedCount` INTEGER NOT NULL DEFAULT 0,
    `validSpinRateCount` INTEGER NOT NULL DEFAULT 0,
    `validMaxHeightCount` INTEGER NOT NULL DEFAULT 0,
    `validCarryCount` INTEGER NOT NULL DEFAULT 0,
    `validTotalCount` INTEGER NOT NULL DEFAULT 0,
    `isManuallyEdited` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImportClubSummary_importBatchId_idx`(`importBatchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ImportClubSummary` ADD CONSTRAINT `ImportClubSummary_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `ImportBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
