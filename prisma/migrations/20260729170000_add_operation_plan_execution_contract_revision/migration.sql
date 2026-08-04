-- Incompatible approval execution-contract cutover.
-- Apply only after draining in-flight approval commands and stopping old app
-- processes. The final NOT NULL column intentionally has no default so an old
-- runtime cannot create an unversioned approval snapshot after this cutover.

ALTER TABLE `operation_plan_snapshots`
  ADD COLUMN `executionContractRevision` VARCHAR(128) NULL AFTER `operationId`;

UPDATE `operation_plan_snapshots`
SET `executionContractRevision` = CASE
  WHEN `operationId` IN ('create_image', 'create_audio', 'create_video')
    THEN 'creative-resource-generation/v1'
  WHEN `operationId` = 'generate_voice'
    THEN 'voice-generation/v1'
  ELSE CONCAT(`operationId`, '/legacy-v1')
END;

ALTER TABLE `operation_plan_snapshots`
  MODIFY `executionContractRevision` VARCHAR(128) NOT NULL;
