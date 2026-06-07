ALTER TABLE `project_characters`
  DROP FOREIGN KEY `project_characters_customVoiceMediaId_fkey`;

ALTER TABLE `project_panels`
  DROP FOREIGN KEY `project_panels_lipSyncVideoMediaId_fkey`;

ALTER TABLE `project_voice_lines`
  DROP FOREIGN KEY `project_voice_lines_audioMediaId_fkey`,
  DROP FOREIGN KEY `project_voice_lines_episodeId_fkey`,
  DROP FOREIGN KEY `project_voice_lines_matchedPanelId_fkey`;

ALTER TABLE `global_characters`
  DROP FOREIGN KEY `global_characters_customVoiceMediaId_fkey`;

ALTER TABLE `voice_presets`
  DROP FOREIGN KEY `voice_presets_audioMediaId_fkey`;

ALTER TABLE `global_voices`
  DROP FOREIGN KEY `global_voices_customVoiceMediaId_fkey`,
  DROP FOREIGN KEY `global_voices_folderId_fkey`,
  DROP FOREIGN KEY `global_voices_userId_fkey`;

ALTER TABLE `project_characters`
  DROP INDEX `project_characters_customVoiceMediaId_idx`;

ALTER TABLE `project_panels`
  DROP INDEX `project_panels_lipSyncVideoMediaId_idx`;

ALTER TABLE `global_characters`
  DROP INDEX `global_characters_customVoiceMediaId_idx`;

ALTER TABLE `project_characters`
  DROP COLUMN `customVoiceMediaId`,
  DROP COLUMN `customVoiceUrl`,
  DROP COLUMN `voiceId`,
  DROP COLUMN `voiceType`;

ALTER TABLE `project_episodes`
  DROP COLUMN `speakerVoices`;

ALTER TABLE `project_panels`
  DROP COLUMN `lipSyncTaskId`,
  DROP COLUMN `lipSyncVideoMediaId`,
  DROP COLUMN `lipSyncVideoUrl`;

ALTER TABLE `projects`
  DROP COLUMN `audioModel`;

ALTER TABLE `user_preferences`
  DROP COLUMN `audioModel`,
  DROP COLUMN `lipSyncModel`,
  DROP COLUMN `qwenApiKey`,
  DROP COLUMN `voiceDesignModel`;

ALTER TABLE `global_characters`
  DROP COLUMN `customVoiceMediaId`,
  DROP COLUMN `customVoiceUrl`,
  DROP COLUMN `globalVoiceId`,
  DROP COLUMN `voiceId`,
  DROP COLUMN `voiceType`;

DROP TABLE `project_voice_lines`;
DROP TABLE `voice_presets`;
DROP TABLE `global_voices`;
