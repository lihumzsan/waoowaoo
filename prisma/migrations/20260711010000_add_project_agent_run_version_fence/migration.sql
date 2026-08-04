ALTER TABLE `project_agent_runs`
  ADD COLUMN `runVersion` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `eventSeq` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `terminalEventSeq` BIGINT NULL;

UPDATE `project_agent_runs` AS `r`
LEFT JOIN (
  SELECT `runId`, MAX(`id`) AS `maxEventSeq`
  FROM `project_agent_events`
  WHERE `runId` IS NOT NULL
  GROUP BY `runId`
) AS `e` ON `e`.`runId` = `r`.`id`
SET
  `r`.`eventSeq` = COALESCE(`e`.`maxEventSeq`, 0),
  `r`.`terminalEventSeq` = CASE
    WHEN `r`.`status` IN ('completed', 'failed', 'cancelled')
      THEN COALESCE(`e`.`maxEventSeq`, 0)
    ELSE NULL
  END;

ALTER TABLE `project_agent_waits`
  ADD COLUMN `runVersion` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `eventSeq` BIGINT NOT NULL DEFAULT 0;

UPDATE `project_agent_waits` AS `w`
INNER JOIN `project_agent_runs` AS `r` ON `r`.`id` = `w`.`runId`
SET
  `w`.`runVersion` = `r`.`runVersion`,
  `w`.`eventSeq` = `r`.`eventSeq`;

ALTER TABLE `project_agent_interruptions`
  ADD COLUMN `runVersion` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `eventSeq` BIGINT NOT NULL DEFAULT 0;

UPDATE `project_agent_interruptions` AS `i`
INNER JOIN `project_agent_runs` AS `r` ON `r`.`id` = `i`.`runId`
SET
  `i`.`runVersion` = `r`.`runVersion`,
  `i`.`eventSeq` = `r`.`eventSeq`;
