ALTER TABLE `projects`
  ADD COLUMN `videoVocalPerformanceMode` VARCHAR(32) NOT NULL DEFAULT 'native_dialogue';

ALTER TABLE `workspace_resources`
  ADD COLUMN `vocalPerformanceMode` VARCHAR(32) NULL;
