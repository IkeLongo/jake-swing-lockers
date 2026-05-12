-- AlterTable
ALTER TABLE `ImportBatch` ADD COLUMN `demoSessionId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `ImportBatch_demoSessionId_idx` ON `ImportBatch`(`demoSessionId`);

-- AddForeignKey
ALTER TABLE `ImportBatch` ADD CONSTRAINT `ImportBatch_demoSessionId_fkey` FOREIGN KEY (`demoSessionId`) REFERENCES `DemoSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
