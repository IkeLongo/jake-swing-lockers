-- AlterTable
ALTER TABLE `DemoSession` ADD COLUMN `accessInviteError` TEXT NULL,
    ADD COLUMN `accessInviteQueuedAt` DATETIME(3) NULL,
    ADD COLUMN `accessInviteSentAt` DATETIME(3) NULL,
    ADD COLUMN `accessInviteStatus` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `DemoSession_accessInviteStatus_idx` ON `DemoSession`(`accessInviteStatus`);
