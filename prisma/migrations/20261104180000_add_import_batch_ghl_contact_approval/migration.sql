ALTER TABLE `ImportBatch`
  ADD COLUMN `ghlContactDecision` VARCHAR(16) NULL,
  ADD COLUMN `approvedGhlContactId` VARCHAR(64) NULL,
  ADD COLUMN `ghlContactApprovalSignature` VARCHAR(64) NULL,
  ADD COLUMN `ghlContactApprovedAt` DATETIME(3) NULL,
  ADD COLUMN `ghlContactApprovedByStaffUserId` INTEGER NULL,
  ADD COLUMN `ghlContactReviewSnapshot` JSON NULL;
