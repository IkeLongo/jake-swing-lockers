-- CreateTable
CREATE TABLE `SwingLockerOtp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `golfClientId` INTEGER NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SwingLockerOtp_golfClientId_idx`(`golfClientId`),
    INDEX `SwingLockerOtp_expiresAt_idx`(`expiresAt`),
    INDEX `SwingLockerOtp_usedAt_idx`(`usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SwingLockerOtp` ADD CONSTRAINT `SwingLockerOtp_golfClientId_fkey` FOREIGN KEY (`golfClientId`) REFERENCES `GolfClient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
