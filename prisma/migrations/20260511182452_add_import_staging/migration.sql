-- CreateTable
CREATE TABLE `ImportBatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `originalFileName` VARCHAR(191) NOT NULL,
    `uploadedByStaffUserId` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'uploaded',
    `rowCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImportBatch_uploadedByStaffUserId_idx`(`uploadedByStaffUserId`),
    INDEX `ImportBatch_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportRow` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `importBatchId` INTEGER NOT NULL,
    `rowIndex` INTEGER NOT NULL,
    `rawData` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `validationErrors` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImportRow_importBatchId_idx`(`importBatchId`),
    INDEX `ImportRow_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ImportBatch` ADD CONSTRAINT `ImportBatch_uploadedByStaffUserId_fkey` FOREIGN KEY (`uploadedByStaffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportRow` ADD CONSTRAINT `ImportRow_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `ImportBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
