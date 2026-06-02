CREATE TABLE `project_edit_director_decoupages` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `editScreenplayId` VARCHAR(191) NOT NULL,
  `userPrompt` LONGTEXT NOT NULL,
  `decoupageJson` JSON NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ready',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_edit_director_decoupages_episodeId_key`(`episodeId`),
  UNIQUE INDEX `project_edit_director_decoupages_editScreenplayId_key`(`editScreenplayId`),
  INDEX `project_edit_director_decoupages_projectId_idx`(`projectId`),
  INDEX `project_edit_director_decoupages_episodeId_idx`(`episodeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_edit_cinematography_shot_plans` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `editScriptId` VARCHAR(191) NOT NULL,
  `shotPlanJson` JSON NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ready',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_edit_cinematography_shot_plans_episodeId_key`(`episodeId`),
  UNIQUE INDEX `project_edit_cinematography_shot_plans_editScriptId_key`(`editScriptId`),
  INDEX `project_edit_cinematography_shot_plans_projectId_idx`(`projectId`),
  INDEX `project_edit_cinematography_shot_plans_episodeId_idx`(`episodeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_edit_director_decoupages`
  ADD CONSTRAINT `project_edit_director_decoupages_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_director_decoupages`
  ADD CONSTRAINT `project_edit_director_decoupages_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_director_decoupages`
  ADD CONSTRAINT `project_edit_director_decoupages_editScreenplayId_fkey`
  FOREIGN KEY (`editScreenplayId`) REFERENCES `project_edit_screenplays`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_cinematography_shot_plans`
  ADD CONSTRAINT `project_edit_cinematography_shot_plans_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_cinematography_shot_plans`
  ADD CONSTRAINT `project_edit_cinematography_shot_plans_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_cinematography_shot_plans`
  ADD CONSTRAINT `project_edit_cinematography_shot_plans_editScriptId_fkey`
  FOREIGN KEY (`editScriptId`) REFERENCES `project_edit_scripts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
