-- Phase 2 canonical source chain cleanup.
-- This migration intentionally removes the old ProjectEditScreenplay track.
-- Existing screenplay/style-preview/edit-script artifacts are discarded because
-- the canonical input is now SourceDocument + EditBible + ProjectEditChapter.
-- Before applying it to any non-throwaway database, create and verify a database backup.

DELETE FROM `project_edit_style_previews`;
DELETE FROM `project_edit_scripts`;
DELETE FROM `project_edit_screenplays`;

ALTER TABLE `project_edit_style_previews`
  DROP FOREIGN KEY `project_edit_style_previews_editScreenplayId_fkey`;

DROP INDEX `project_edit_style_previews_editScreenplayId_styleKey_key`
  ON `project_edit_style_previews`;

DROP INDEX `project_edit_style_previews_editScreenplayId_idx`
  ON `project_edit_style_previews`;

ALTER TABLE `project_edit_style_previews`
  DROP COLUMN `editScreenplayId`,
  ADD COLUMN `editBibleId` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `project_edit_style_previews_editBibleId_styleKey_key`
  ON `project_edit_style_previews`(`editBibleId`, `styleKey`);

CREATE INDEX `project_edit_style_previews_editBibleId_idx`
  ON `project_edit_style_previews`(`editBibleId`);

ALTER TABLE `project_edit_style_previews`
  ADD CONSTRAINT `project_edit_style_previews_editBibleId_fkey`
  FOREIGN KEY (`editBibleId`) REFERENCES `project_edit_bibles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_scripts`
  DROP FOREIGN KEY `project_edit_scripts_editScreenplayId_fkey`;

DROP INDEX `project_edit_scripts_editScreenplayId_key`
  ON `project_edit_scripts`;

DROP INDEX `project_edit_scripts_editScreenplayId_idx`
  ON `project_edit_scripts`;

ALTER TABLE `project_edit_scripts`
  DROP COLUMN `editScreenplayId`;

DROP TABLE `project_edit_screenplays`;
