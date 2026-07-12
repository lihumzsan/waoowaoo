-- This migration is an incompatible single-contract cutover.
-- Run `npm run db:async-migration-preflight` in a maintenance window before applying it.

UPDATE `project_agent_interruptions`
SET `payload` = JSON_REMOVE(`payload`, '$.schemaVersion')
WHERE `type` = 'choice'
  AND JSON_CONTAINS_PATH(`payload`, 'one', '$.schemaVersion') = 1;

UPDATE `location_images`
SET `spatialProfileJson` = JSON_REMOVE(`spatialProfileJson`, '$.schemaVersion')
WHERE `spatialProfileJson` IS NOT NULL
  AND JSON_CONTAINS_PATH(`spatialProfileJson`, 'one', '$.schemaVersion') = 1;

UPDATE `global_location_images`
SET `spatialProfileJson` = JSON_REMOVE(`spatialProfileJson`, '$.schemaVersion')
WHERE `spatialProfileJson` IS NOT NULL
  AND JSON_CONTAINS_PATH(`spatialProfileJson`, 'one', '$.schemaVersion') = 1;

UPDATE `project_edit_soundscapes`
SET `planJson` = JSON_REMOVE(`planJson`, '$.schemaVersion')
WHERE `planJson` IS NOT NULL
  AND JSON_CONTAINS_PATH(`planJson`, 'one', '$.schemaVersion') = 1;

UPDATE `project_edit_music_scores`
SET `cuesJson` = JSON_REMOVE(`cuesJson`, '$.schemaVersion')
WHERE `cuesJson` IS NOT NULL
  AND JSON_CONTAINS_PATH(`cuesJson`, 'one', '$.schemaVersion') = 1;

UPDATE `project_episode_source_documents`
SET `scriptStructureJson` = JSON_REMOVE(`scriptStructureJson`, '$.version')
WHERE `scriptStructureJson` IS NOT NULL
  AND JSON_CONTAINS_PATH(`scriptStructureJson`, 'one', '$.version') = 1;

UPDATE `task_execution_checkpoints`
SET `output` = JSON_REMOVE(`output`, '$.contractVersion')
WHERE `stepKey` LIKE 'provider:%'
  AND JSON_CONTAINS_PATH(`output`, 'one', '$.contractVersion') = 1;

UPDATE `outbox_commands`
SET `payload` = JSON_REMOVE(`payload`, '$.version')
WHERE JSON_CONTAINS_PATH(`payload`, 'one', '$.version') = 1;

ALTER TABLE `outbox_commands`
  DROP COLUMN `version`;

ALTER TABLE `project_edit_music_scores`
  DROP COLUMN `version`;

ALTER TABLE `project_edit_soundscapes`
  DROP COLUMN `version`;

ALTER TABLE `operation_plan_snapshots`
  DROP COLUMN `contractVersion`;

ALTER TABLE `approval_grants`
  DROP COLUMN `contractVersion`;

ALTER TABLE `operation_executions`
  DROP COLUMN `contractVersion`;
