CREATE TABLE `project_edit_soundscapes` (
  `id` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `planJson` JSON NULL,
  `sourcesJson` JSON NULL,
  `mixJson` JSON NULL,
  `diagnosticsJson` JSON NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `taskId` VARCHAR(191) NULL,
  `timelineSignature` VARCHAR(191) NULL,
  `soundEffectModel` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_edit_soundscapes_episodeId_key`(`episodeId`),
  INDEX `project_edit_soundscapes_episodeId_idx`(`episodeId`),
  INDEX `project_edit_soundscapes_taskId_idx`(`taskId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_edit_soundscapes`
  ADD CONSTRAINT `project_edit_soundscapes_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `projects`
  ADD COLUMN `soundEffectModel` VARCHAR(191) NULL;

ALTER TABLE `user_preferences`
  ADD COLUMN `soundEffectModel` VARCHAR(191) NULL;
