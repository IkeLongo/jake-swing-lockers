ALTER TABLE `ImportBatch`
  ADD COLUMN `proposedOpportunityName` VARCHAR(255) NULL,
  ADD COLUMN `fittingDateOverride` DATETIME(3) NULL;
