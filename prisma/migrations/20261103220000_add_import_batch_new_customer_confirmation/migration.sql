ALTER TABLE `ImportBatch`
  ADD COLUMN `newCustomerConfirmationSignature` VARCHAR(64) NULL,
  ADD COLUMN `newCustomerConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN `newCustomerConfirmedByStaffUserId` INTEGER NULL,
  ADD COLUMN `newCustomerReviewedCandidates` JSON NULL;
