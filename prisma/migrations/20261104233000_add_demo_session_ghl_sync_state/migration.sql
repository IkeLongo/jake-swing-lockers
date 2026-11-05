ALTER TABLE `DemoSession`
  ADD COLUMN `ghlSyncState` JSON NULL;

ALTER TABLE `GolfClient`
  ADD COLUMN `ghlContactCreationState` JSON NULL;

CREATE TABLE `StagedCustomerCreationMutex` (
  `id` INTEGER NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `StagedCustomerCreationMutex` (`id`) VALUES (1);
