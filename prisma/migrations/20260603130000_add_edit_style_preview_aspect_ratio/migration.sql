ALTER TABLE `project_edit_style_previews`
  ADD COLUMN `aspectRatio` VARCHAR(191) NOT NULL DEFAULT '16:9';

ALTER TABLE `project_edit_style_previews`
  ALTER COLUMN `aspectRatio` DROP DEFAULT;
