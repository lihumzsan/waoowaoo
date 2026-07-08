-- Phase 1 long-form foundation.
-- This migration intentionally discards existing edit-first generated artifacts.
-- Before applying it to any non-throwaway database, create and verify a database backup.

-- Clear generated edit-first artifacts before replacing episode-scoped identity with chapter-scoped identity.
DELETE FROM `project_storyboards`;
DELETE FROM `project_video_groups`;
DELETE FROM `project_edit_shot_execution_plans`;
DELETE FROM `project_edit_asset_requirements`;
DELETE FROM `project_edit_scripts`;

-- Create canonical chapter 0 for every existing episode.
CREATE TABLE `project_edit_chapters` (
  `id` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `chapterIndex` INTEGER NOT NULL,
  `title` VARCHAR(191) NULL,
  `summary` TEXT NULL,
  `sourceDocumentId` VARCHAR(191) NULL,
  `sourceStart` INTEGER NULL,
  `sourceEnd` INTEGER NULL,
  `targetDurationSec` INTEGER NULL,
  `entrySnapshotJson` JSON NULL,
  `eventsJson` JSON NULL,
  `planVersion` INTEGER NOT NULL DEFAULT 1,
  `provenanceJson` JSON NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ready',
  `renderStatus` VARCHAR(191) NULL,
  `renderTaskId` VARCHAR(191) NULL,
  `outputMediaId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `project_edit_chapters_episodeId_idx`(`episodeId`),
  INDEX `project_edit_chapters_outputMediaId_idx`(`outputMediaId`),
  UNIQUE INDEX `project_edit_chapters_episodeId_chapterIndex_key`(`episodeId`, `chapterIndex`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `project_edit_chapters` (`id`, `episodeId`, `chapterIndex`, `status`, `createdAt`, `updatedAt`)
SELECT UUID(), `id`, 0, 'ready', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `project_episodes`;

-- Existing unique indexes on episodeId backed old one-edit-per-episode semantics.
ALTER TABLE `project_edit_scripts` DROP FOREIGN KEY `project_edit_scripts_episodeId_fkey`;
ALTER TABLE `project_edit_shot_execution_plans` DROP FOREIGN KEY `project_edit_shot_execution_plans_episodeId_fkey`;
DROP INDEX `project_edit_scripts_episodeId_key` ON `project_edit_scripts`;
DROP INDEX `project_edit_shot_execution_plans_episodeId_key` ON `project_edit_shot_execution_plans`;

ALTER TABLE `project_edit_scripts`
  ADD COLUMN `chapterId` VARCHAR(191) NOT NULL;

ALTER TABLE `project_edit_shot_execution_plans`
  ADD COLUMN `chapterId` VARCHAR(191) NOT NULL;

ALTER TABLE `project_edit_asset_requirements`
  DROP COLUMN `requiredForShotNumbers`,
  ADD COLUMN `chapterId` VARCHAR(191) NOT NULL,
  ADD COLUMN `requiredForShotIds` JSON NOT NULL;

ALTER TABLE `project_video_groups`
  ADD COLUMN `chapterId` VARCHAR(191) NOT NULL,
  ADD COLUMN `shotIds` JSON NOT NULL;

DROP INDEX `project_panels_sourceShotNumber_idx` ON `project_panels`;
ALTER TABLE `project_panels`
  DROP COLUMN `sourceShotNumber`,
  ADD COLUMN `sourceShotId` VARCHAR(191) NULL;

ALTER TABLE `project_storyboards`
  ADD COLUMN `chapterId` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `project_edit_scripts_chapterId_key` ON `project_edit_scripts`(`chapterId`);
CREATE INDEX `project_edit_scripts_episodeId_idx` ON `project_edit_scripts`(`episodeId`);
CREATE INDEX `project_edit_scripts_chapterId_idx` ON `project_edit_scripts`(`chapterId`);

CREATE UNIQUE INDEX `project_edit_shot_execution_plans_chapterId_key` ON `project_edit_shot_execution_plans`(`chapterId`);
CREATE INDEX `project_edit_shot_execution_plans_episodeId_idx` ON `project_edit_shot_execution_plans`(`episodeId`);
CREATE INDEX `project_edit_shot_execution_plans_chapterId_idx` ON `project_edit_shot_execution_plans`(`chapterId`);

CREATE INDEX `project_edit_asset_requirements_chapterId_idx` ON `project_edit_asset_requirements`(`chapterId`);
CREATE INDEX `project_video_groups_chapterId_idx` ON `project_video_groups`(`chapterId`);
CREATE INDEX `project_panels_sourceShotId_idx` ON `project_panels`(`sourceShotId`);
CREATE INDEX `project_storyboards_chapterId_idx` ON `project_storyboards`(`chapterId`);

ALTER TABLE `project_edit_chapters`
  ADD CONSTRAINT `project_edit_chapters_outputMediaId_fkey`
  FOREIGN KEY (`outputMediaId`) REFERENCES `media_objects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `project_edit_chapters`
  ADD CONSTRAINT `project_edit_chapters_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_scripts`
  ADD CONSTRAINT `project_edit_scripts_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_scripts`
  ADD CONSTRAINT `project_edit_scripts_chapterId_fkey`
  FOREIGN KEY (`chapterId`) REFERENCES `project_edit_chapters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_shot_execution_plans`
  ADD CONSTRAINT `project_edit_shot_execution_plans_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_shot_execution_plans`
  ADD CONSTRAINT `project_edit_shot_execution_plans_chapterId_fkey`
  FOREIGN KEY (`chapterId`) REFERENCES `project_edit_chapters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_asset_requirements`
  ADD CONSTRAINT `project_edit_asset_requirements_chapterId_fkey`
  FOREIGN KEY (`chapterId`) REFERENCES `project_edit_chapters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_video_groups`
  ADD CONSTRAINT `project_video_groups_chapterId_fkey`
  FOREIGN KEY (`chapterId`) REFERENCES `project_edit_chapters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_storyboards`
  ADD CONSTRAINT `project_storyboards_chapterId_fkey`
  FOREIGN KEY (`chapterId`) REFERENCES `project_edit_chapters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
