-- DropForeignKey
ALTER TABLE `GhlSyncEvent` DROP FOREIGN KEY `GhlSyncEvent_demoSessionId_fkey`;

-- AlterTable
ALTER TABLE `GhlSyncEvent` MODIFY `demoSessionId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `GhlSyncEvent` ADD CONSTRAINT `GhlSyncEvent_demoSessionId_fkey` FOREIGN KEY (`demoSessionId`) REFERENCES `DemoSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
