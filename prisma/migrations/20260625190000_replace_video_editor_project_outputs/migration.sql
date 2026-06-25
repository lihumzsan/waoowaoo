DROP TABLE IF EXISTS `video_editor_projects`;

CREATE TABLE `project_episode_final_outputs` (
  `id` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `bgmScoreJson` JSON NULL,
  `renderStatus` VARCHAR(191) NULL,
  `renderTaskId` VARCHAR(191) NULL,
  `outputUrl` TEXT NULL,
  `outputMediaId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_episode_final_outputs_episodeId_key`(`episodeId`),
  INDEX `project_episode_final_outputs_outputMediaId_idx`(`outputMediaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_episode_final_outputs`
  ADD CONSTRAINT `project_episode_final_outputs_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_episode_final_outputs`
  ADD CONSTRAINT `project_episode_final_outputs_outputMediaId_fkey`
  FOREIGN KEY (`outputMediaId`) REFERENCES `media_objects`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
