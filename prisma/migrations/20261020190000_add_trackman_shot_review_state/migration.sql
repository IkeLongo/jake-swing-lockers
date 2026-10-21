ALTER TABLE `ImportRow`
  ADD COLUMN `clubSummaryId` INTEGER NULL,
  ADD COLUMN `includedInSummary` BOOLEAN NULL;

CREATE INDEX `ImportRow_clubSummaryId_idx`
  ON `ImportRow`(`clubSummaryId`);

ALTER TABLE `ImportRow`
  ADD CONSTRAINT `ImportRow_clubSummaryId_fkey`
  FOREIGN KEY (`clubSummaryId`) REFERENCES `ImportClubSummary`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
