-- The SDK transcript becomes the only model-history authority. Existing UI
-- messages are deliberately not interpreted or backfilled into model history:
-- their structured parts cannot be reconstructed into an exact AgentInputItem
-- sequence without guessing.
ALTER TABLE `project_assistant_threads`
  ADD COLUMN `modelHistoryJson` JSON NULL,
  ADD COLUMN `modelHistoryVersion` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `pendingModelHistoryJson` JSON NULL,
  ADD COLUMN `pendingModelHistorySegmentId` VARCHAR(191) NULL,
  ADD COLUMN `pendingModelHistoryBaseVersion` INTEGER NULL,
  ADD COLUMN `pendingModelHistoryReady` BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE `project_assistant_threads`
SET `modelHistoryJson` = JSON_ARRAY()
WHERE `modelHistoryJson` IS NULL;

ALTER TABLE `project_assistant_threads`
  MODIFY COLUMN `modelHistoryJson` JSON NOT NULL;
