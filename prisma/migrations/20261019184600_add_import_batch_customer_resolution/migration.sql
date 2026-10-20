ALTER TABLE `ImportBatch`
  ADD COLUMN `customerResolution` VARCHAR(191) NULL,
  ADD COLUMN `selectedGolfClientId` INTEGER NULL,
  ADD COLUMN `proposedFirstName` VARCHAR(191) NULL,
  ADD COLUMN `proposedLastName` VARCHAR(191) NULL,
  ADD COLUMN `proposedEmail` VARCHAR(191) NULL,
  ADD COLUMN `proposedPhone` VARCHAR(191) NULL;

CREATE INDEX `ImportBatch_selectedGolfClientId_idx`
  ON `ImportBatch`(`selectedGolfClientId`);

ALTER TABLE `ImportBatch`
  ADD CONSTRAINT `ImportBatch_selectedGolfClientId_fkey`
  FOREIGN KEY (`selectedGolfClientId`) REFERENCES `GolfClient`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
