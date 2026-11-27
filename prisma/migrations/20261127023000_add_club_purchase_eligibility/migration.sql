-- AlterTable
ALTER TABLE `DemoClubTest` ADD COLUMN `availableForPurchase` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `tags` JSON NULL;

-- AlterTable
ALTER TABLE `ImportClubSummary` ADD COLUMN `availableForPurchase` BOOLEAN NOT NULL DEFAULT false;
