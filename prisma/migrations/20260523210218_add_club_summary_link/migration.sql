-- AlterTable
ALTER TABLE `ImportClubSummary` ADD COLUMN `linkedToSummaryId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `ImportClubSummary_linkedToSummaryId_idx` ON `ImportClubSummary`(`linkedToSummaryId`);

-- AddForeignKey
ALTER TABLE `ImportClubSummary` ADD CONSTRAINT `ImportClubSummary_linkedToSummaryId_fkey` FOREIGN KEY (`linkedToSummaryId`) REFERENCES `ImportClubSummary`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
