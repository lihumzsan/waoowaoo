-- Move episode music score state out of final render output.
-- ProjectEpisodeFinalOutput now stores only final render output state.

CREATE TABLE `project_edit_music_scores` (
  `id` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `cuesJson` JSON NULL,
  `mixJson` JSON NULL,
  `diagnosticsJson` JSON NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `taskId` VARCHAR(191) NULL,
  `timelineSignature` VARCHAR(191) NULL,
  `musicModel` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_edit_music_scores_episodeId_key`(`episodeId`),
  INDEX `project_edit_music_scores_episodeId_idx`(`episodeId`),
  INDEX `project_edit_music_scores_taskId_idx`(`taskId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `project_edit_music_scores` (
  `id`,
  `episodeId`,
  `cuesJson`,
  `mixJson`,
  `version`,
  `status`,
  `taskId`,
  `timelineSignature`,
  `musicModel`,
  `createdAt`,
  `updatedAt`
)
SELECT
  UUID(),
  `episodeId`,
  `bgmScoreJson`,
  JSON_EXTRACT(`bgmScoreJson`, '$.mix'),
  1,
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`bgmScoreJson`, '$.status')), 'pending'),
  JSON_UNQUOTE(JSON_EXTRACT(`bgmScoreJson`, '$.taskId')),
  JSON_UNQUOTE(JSON_EXTRACT(`bgmScoreJson`, '$.timelineSignature')),
  JSON_UNQUOTE(JSON_EXTRACT(`bgmScoreJson`, '$.musicModel')),
  `createdAt`,
  `updatedAt`
FROM `project_episode_final_outputs`
WHERE `bgmScoreJson` IS NOT NULL;

ALTER TABLE `project_edit_music_scores`
  ADD CONSTRAINT `project_edit_music_scores_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_episode_final_outputs`
  DROP COLUMN `bgmScoreJson`;
