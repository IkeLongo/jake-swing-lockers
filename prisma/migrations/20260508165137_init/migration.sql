-- CreateTable
CREATE TABLE `GolfClient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ghlContactId` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GolfClient_ghlContactId_key`(`ghlContactId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DemoSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clientId` INTEGER NOT NULL,
    `lockerToken` VARCHAR(191) NOT NULL,
    `lockerUrl` VARCHAR(191) NULL,
    `demoDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `salesRep` VARCHAR(191) NULL,
    `journeyStage` VARCHAR(191) NOT NULL DEFAULT 'demo_completed',
    `clubTested` VARCHAR(191) NULL,
    `clientGoal` VARCHAR(191) NULL,
    `currentClub` VARCHAR(191) NULL,
    `recommendedProduct` VARCHAR(191) NULL,
    `recommendedShaft` VARCHAR(191) NULL,
    `recommendedLoft` VARCHAR(191) NULL,
    `estimatedPrice` DECIMAL(10, 2) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DemoSession_lockerToken_key`(`lockerToken`),
    INDEX `DemoSession_clientId_idx`(`clientId`),
    INDEX `DemoSession_journeyStage_idx`(`journeyStage`),
    INDEX `DemoSession_demoDate_idx`(`demoDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SwingMetrics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `demoSessionId` INTEGER NOT NULL,
    `clubSpeed` DECIMAL(6, 2) NULL,
    `ballSpeed` DECIMAL(6, 2) NULL,
    `smashFactor` DECIMAL(5, 2) NULL,
    `carryDistance` DECIMAL(6, 2) NULL,
    `totalDistance` DECIMAL(6, 2) NULL,
    `launchAngle` DECIMAL(5, 2) NULL,
    `spinRate` INTEGER NULL,
    `dispersion` DECIMAL(6, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SwingMetrics_demoSessionId_key`(`demoSessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GhlSyncEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `demoSessionId` INTEGER NOT NULL,
    `ghlContactId` VARCHAR(191) NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `message` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GhlSyncEvent_demoSessionId_idx`(`demoSessionId`),
    INDEX `GhlSyncEvent_status_idx`(`status`),
    INDEX `GhlSyncEvent_eventType_idx`(`eventType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DemoSession` ADD CONSTRAINT `DemoSession_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `GolfClient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SwingMetrics` ADD CONSTRAINT `SwingMetrics_demoSessionId_fkey` FOREIGN KEY (`demoSessionId`) REFERENCES `DemoSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GhlSyncEvent` ADD CONSTRAINT `GhlSyncEvent_demoSessionId_fkey` FOREIGN KEY (`demoSessionId`) REFERENCES `DemoSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
