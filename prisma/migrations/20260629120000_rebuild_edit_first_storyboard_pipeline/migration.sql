DELETE FROM `project_video_groups`;

DELETE FROM `project_edit_scripts`;

DROP TABLE IF EXISTS `project_storyboard_blocking_artifacts`;

DROP TABLE IF EXISTS `project_edit_cinematography_shot_plans`;

DROP TABLE IF EXISTS `project_edit_director_decoupages`;

ALTER TABLE `project_edit_scripts`
  DROP COLUMN `userPrompt`,
  DROP COLUMN `styleBibleJson`,
  DROP COLUMN `screenplayText`,
  DROP COLUMN `title`,
  DROP COLUMN `logline`,
  DROP COLUMN `shotsJson`,
  DROP COLUMN `videoBlocksJson`,
  ADD COLUMN `editScreenplayId` VARCHAR(191) NOT NULL,
  ADD COLUMN `corePlanJson` JSON NULL;

CREATE UNIQUE INDEX `project_edit_scripts_editScreenplayId_key`
  ON `project_edit_scripts`(`editScreenplayId`);

CREATE INDEX `project_edit_scripts_editScreenplayId_idx`
  ON `project_edit_scripts`(`editScreenplayId`);

ALTER TABLE `project_edit_scripts`
  ADD CONSTRAINT `project_edit_scripts_editScreenplayId_fkey`
  FOREIGN KEY (`editScreenplayId`) REFERENCES `project_edit_screenplays`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `project_edit_shot_execution_plans` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `editScriptId` VARCHAR(191) NOT NULL,
  `executionPlanJson` JSON NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ready',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_edit_shot_execution_plans_episodeId_key`(`episodeId`),
  UNIQUE INDEX `project_edit_shot_execution_plans_editScriptId_key`(`editScriptId`),
  INDEX `project_edit_shot_execution_plans_projectId_idx`(`projectId`),
  INDEX `project_edit_shot_execution_plans_episodeId_idx`(`episodeId`),
  INDEX `project_edit_shot_execution_plans_editScriptId_idx`(`editScriptId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_edit_shot_execution_plans`
  ADD CONSTRAINT `project_edit_shot_execution_plans_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_shot_execution_plans`
  ADD CONSTRAINT `project_edit_shot_execution_plans_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_shot_execution_plans`
  ADD CONSTRAINT `project_edit_shot_execution_plans_editScriptId_fkey`
  FOREIGN KEY (`editScriptId`) REFERENCES `project_edit_scripts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_asset_requirements`
  CHANGE COLUMN `shotIndexes` `requiredForShotNumbers` JSON NOT NULL;

ALTER TABLE `project_panels`
  DROP COLUMN `photographyRules`,
  ADD COLUMN `sourceShotNumber` INTEGER NULL,
  ADD COLUMN `sourceGenerationSegmentId` TEXT NULL,
  ADD COLUMN `executionSnapshotJson` JSON NULL,
  ADD COLUMN `renderFactsJson` JSON NULL;

CREATE INDEX `project_panels_sourceShotNumber_idx`
  ON `project_panels`(`sourceShotNumber`);
