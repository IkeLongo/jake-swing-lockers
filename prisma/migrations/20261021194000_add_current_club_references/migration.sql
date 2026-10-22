-- AlterTable
ALTER TABLE `DemoClubTest` ADD COLUMN `currentClubTestId` INTEGER NULL;

-- AlterTable
ALTER TABLE `ImportClubSummary` ADD COLUMN `currentSummaryId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `DemoClubTest_currentClubTestId_idx` ON `DemoClubTest`(`currentClubTestId`);

-- CreateIndex
CREATE INDEX `ImportClubSummary_currentSummaryId_idx` ON `ImportClubSummary`(`currentSummaryId`);

-- AddForeignKey
ALTER TABLE `DemoClubTest` ADD CONSTRAINT `DemoClubTest_currentClubTestId_fkey` FOREIGN KEY (`currentClubTestId`) REFERENCES `DemoClubTest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportClubSummary` ADD CONSTRAINT `ImportClubSummary_currentSummaryId_fkey` FOREIGN KEY (`currentSummaryId`) REFERENCES `ImportClubSummary`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (EXPAND phase; linkedToSummaryId is left untouched).
-- Legacy: CURRENT.linkedToSummaryId = TEST.id
-- New:    TEST.currentSummaryId     = CURRENT.id
--
-- Only unambiguous legacy links are converted. A link is skipped when:
--   * the child points at itself or at a row in a different batch,
--   * the "test" row is itself a legacy child (chained link),
--   * the "current" row is itself a legacy parent (chained link),
--   * more than one legacy child points at the same test (ambiguous; a Test
--     has exactly one Current, so no winner is guessed).
-- The GROUP BY also materializes the derived table, which MySQL requires when
-- updating a table that the subquery reads.
UPDATE `ImportClubSummary` AS t
JOIN (
  SELECT c.`linkedToSummaryId` AS testId, MIN(c.`id`) AS currentId
  FROM `ImportClubSummary` AS c
  JOIN `ImportClubSummary` AS p ON p.`id` = c.`linkedToSummaryId`
  WHERE c.`id` <> c.`linkedToSummaryId`
    AND c.`importBatchId` = p.`importBatchId`
    AND p.`linkedToSummaryId` IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM `ImportClubSummary` AS x WHERE x.`linkedToSummaryId` = c.`id`
    )
  GROUP BY c.`linkedToSummaryId`
  HAVING COUNT(*) = 1
) AS m ON m.testId = t.`id`
SET t.`currentSummaryId` = m.currentId;
