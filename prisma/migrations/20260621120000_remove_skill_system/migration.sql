DROP TABLE IF EXISTS `saved_skills`;

ALTER TABLE `execution_plan_steps`
  RENAME COLUMN `skillId` TO `operationId`;

ALTER TABLE `plan_step_runs`
  DROP COLUMN `skillId`;
