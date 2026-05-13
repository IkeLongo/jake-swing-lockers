-- CreateTable
CREATE TABLE `PurchaseRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `golfClientId` INTEGER NOT NULL,
    `demoSessionId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `notes` TEXT NULL,
    `ghlSyncStatus` VARCHAR(191) NULL,
    `ghlLastSyncedAt` DATETIME(3) NULL,
    `ghlSyncError` TEXT NULL,
    `ghlOpportunityId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PurchaseRequest_golfClientId_idx`(`golfClientId`),
    INDEX `PurchaseRequest_demoSessionId_idx`(`demoSessionId`),
    INDEX `PurchaseRequest_status_idx`(`status`),
    INDEX `PurchaseRequest_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseRequestItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchaseRequestId` INTEGER NOT NULL,
    `demoClubTestId` INTEGER NOT NULL,
    `clubType` VARCHAR(191) NULL,
    `estimatedPrice` DECIMAL(10, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PurchaseRequestItem_purchaseRequestId_idx`(`purchaseRequestId`),
    INDEX `PurchaseRequestItem_demoClubTestId_idx`(`demoClubTestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PurchaseRequest` ADD CONSTRAINT `PurchaseRequest_golfClientId_fkey` FOREIGN KEY (`golfClientId`) REFERENCES `GolfClient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequest` ADD CONSTRAINT `PurchaseRequest_demoSessionId_fkey` FOREIGN KEY (`demoSessionId`) REFERENCES `DemoSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequestItem` ADD CONSTRAINT `PurchaseRequestItem_purchaseRequestId_fkey` FOREIGN KEY (`purchaseRequestId`) REFERENCES `PurchaseRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequestItem` ADD CONSTRAINT `PurchaseRequestItem_demoClubTestId_fkey` FOREIGN KEY (`demoClubTestId`) REFERENCES `DemoClubTest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
