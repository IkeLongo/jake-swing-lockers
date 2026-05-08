/*
  Warnings:

  - You are about to drop the column `clubTested` on the `DemoSession` table. All the data in the column will be lost.
  - You are about to drop the column `estimatedPrice` on the `DemoSession` table. All the data in the column will be lost.
  - You are about to drop the column `recommendedLoft` on the `DemoSession` table. All the data in the column will be lost.
  - You are about to drop the column `recommendedProduct` on the `DemoSession` table. All the data in the column will be lost.
  - You are about to drop the column `recommendedShaft` on the `DemoSession` table. All the data in the column will be lost.
  - You are about to drop the `SwingMetrics` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `SwingMetrics` DROP FOREIGN KEY `SwingMetrics_demoSessionId_fkey`;

-- AlterTable
ALTER TABLE `DemoSession` DROP COLUMN `clubTested`,
    DROP COLUMN `estimatedPrice`,
    DROP COLUMN `recommendedLoft`,
    DROP COLUMN `recommendedProduct`,
    DROP COLUMN `recommendedShaft`;

-- DropTable
DROP TABLE `SwingMetrics`;

-- CreateTable
CREATE TABLE `DemoClubTest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `demoSessionId` INTEGER NOT NULL,
    `clubType` VARCHAR(191) NULL,
    `brand` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `shaft` VARCHAR(191) NULL,
    `loft` VARCHAR(191) NULL,
    `estimatedPrice` DECIMAL(10, 2) NULL,
    `notes` TEXT NULL,
    `isRecommended` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DemoClubTest_demoSessionId_idx`(`demoSessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClubTestMetrics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clubTestId` INTEGER NOT NULL,
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

    UNIQUE INDEX `ClubTestMetrics_clubTestId_key`(`clubTestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DemoClubTest` ADD CONSTRAINT `DemoClubTest_demoSessionId_fkey` FOREIGN KEY (`demoSessionId`) REFERENCES `DemoSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClubTestMetrics` ADD CONSTRAINT `ClubTestMetrics_clubTestId_fkey` FOREIGN KEY (`clubTestId`) REFERENCES `DemoClubTest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
