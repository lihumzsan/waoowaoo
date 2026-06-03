CREATE TABLE `project_edit_style_previews` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `editScreenplayId` VARCHAR(191) NOT NULL,
  `styleKey` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `summary` LONGTEXT NOT NULL,
  `styleBibleJson` JSON NOT NULL,
  `imagePrompt` LONGTEXT NOT NULL,
  `imageKey` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `taskId` VARCHAR(191) NULL,
  `errorMessage` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `project_edit_style_previews_editScreenplayId_styleKey_key` ON `project_edit_style_previews`(`editScreenplayId`, `styleKey`);
CREATE INDEX `project_edit_style_previews_projectId_idx` ON `project_edit_style_previews`(`projectId`);
CREATE INDEX `project_edit_style_previews_episodeId_idx` ON `project_edit_style_previews`(`episodeId`);
CREATE INDEX `project_edit_style_previews_editScreenplayId_idx` ON `project_edit_style_previews`(`editScreenplayId`);
CREATE INDEX `project_edit_style_previews_taskId_idx` ON `project_edit_style_previews`(`taskId`);

ALTER TABLE `project_edit_style_previews`
  ADD CONSTRAINT `project_edit_style_previews_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_style_previews`
  ADD CONSTRAINT `project_edit_style_previews_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_style_previews`
  ADD CONSTRAINT `project_edit_style_previews_editScreenplayId_fkey`
  FOREIGN KEY (`editScreenplayId`) REFERENCES `project_edit_screenplays`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
