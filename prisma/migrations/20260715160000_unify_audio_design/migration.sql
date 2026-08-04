CREATE TABLE `project_edit_audio_designs` (
  `id` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `designJson` JSON NULL,
  `diagnosticsJson` JSON NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `taskId` VARCHAR(191) NULL,
  `timelineSignature` VARCHAR(191) NULL,
  `designSignature` VARCHAR(191) NULL,
  `analysisModel` VARCHAR(191) NULL,
  `musicModel` VARCHAR(191) NULL,
  `soundEffectModel` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_edit_audio_designs_episodeId_key`(`episodeId`),
  INDEX `project_edit_audio_designs_episodeId_idx`(`episodeId`),
  INDEX `project_edit_audio_designs_taskId_idx`(`taskId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_edit_audio_designs`
  ADD CONSTRAINT `project_edit_audio_designs_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_music_scores`
  DROP INDEX `project_edit_music_scores_planTaskId_idx`,
  DROP COLUMN `planTaskId`,
  ADD COLUMN `designSignature` VARCHAR(191) NULL;
