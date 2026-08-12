-- Existing Projects remain narrative productions. New Projects must persist
-- one explicit registry-owned production profile identity at creation time.
ALTER TABLE `projects`
  ADD COLUMN `productionProfileId` VARCHAR(64) NOT NULL DEFAULT 'narrative_video',
  ADD COLUMN `productionProfileVersion` INTEGER NOT NULL DEFAULT 1;
