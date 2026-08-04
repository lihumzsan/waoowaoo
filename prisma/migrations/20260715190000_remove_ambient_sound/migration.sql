DROP TABLE IF EXISTS `project_edit_ambient_sounds`;
DROP TABLE IF EXISTS `project_edit_soundscapes`;

RENAME TABLE `project_edit_audio_designs` TO `project_edit_bgm_designs`;

ALTER TABLE `project_edit_bgm_designs`
  RENAME INDEX `project_edit_audio_designs_episodeId_key` TO `project_edit_bgm_designs_episodeId_key`,
  RENAME INDEX `project_edit_audio_designs_episodeId_idx` TO `project_edit_bgm_designs_episodeId_idx`,
  RENAME INDEX `project_edit_audio_designs_taskId_idx` TO `project_edit_bgm_designs_taskId_idx`;

ALTER TABLE `project_edit_bgm_designs`
  DROP FOREIGN KEY `project_edit_audio_designs_episodeId_fkey`,
  ADD CONSTRAINT `project_edit_bgm_designs_episodeId_fkey`
    FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Legacy audio-design JSON contains ambient lanes and cannot satisfy the
-- BGM-only contract. Force every existing episode through the sole planner
-- instead of preserving an incompatible completed design as a hidden fallback.
UPDATE `project_edit_bgm_designs`
SET
  `designJson` = NULL,
  `diagnosticsJson` = NULL,
  `status` = 'pending',
  `taskId` = NULL,
  `timelineSignature` = NULL,
  `designSignature` = NULL,
  `analysisModel` = NULL,
  `musicModel` = NULL,
  `updatedAt` = CURRENT_TIMESTAMP(3);

ALTER TABLE `project_edit_bgm_designs`
  DROP COLUMN `soundEffectModel`;

ALTER TABLE `projects`
  DROP COLUMN `soundEffectModel`;

ALTER TABLE `user_preferences`
  DROP COLUMN `soundEffectModel`;
