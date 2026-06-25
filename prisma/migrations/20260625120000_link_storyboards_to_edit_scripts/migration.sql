ALTER TABLE `project_storyboards`
  ADD COLUMN `editScriptId` VARCHAR(191) NULL;

UPDATE `project_storyboards` AS `storyboard`
INNER JOIN `project_clips` AS `clip`
  ON `clip`.`id` = `storyboard`.`clipId`
SET `storyboard`.`editScriptId` = JSON_UNQUOTE(JSON_EXTRACT(`clip`.`screenplay`, '$.editScriptId'))
WHERE `clip`.`screenplay` IS NOT NULL
  AND JSON_VALID(`clip`.`screenplay`)
  AND JSON_UNQUOTE(JSON_EXTRACT(`clip`.`screenplay`, '$.source')) = 'edit_script'
  AND JSON_UNQUOTE(JSON_EXTRACT(`clip`.`screenplay`, '$.editScriptId')) IS NOT NULL;

ALTER TABLE `project_storyboards`
  MODIFY `clipId` VARCHAR(191) NULL;

UPDATE `project_storyboards` AS `storyboard`
INNER JOIN `project_clips` AS `clip`
  ON `clip`.`id` = `storyboard`.`clipId`
SET `storyboard`.`clipId` = NULL
WHERE `storyboard`.`editScriptId` IS NOT NULL
  AND `clip`.`screenplay` IS NOT NULL
  AND JSON_VALID(`clip`.`screenplay`)
  AND JSON_UNQUOTE(JSON_EXTRACT(`clip`.`screenplay`, '$.source')) = 'edit_script';

UPDATE `project_storyboards`
SET `photographyPlan` = JSON_REMOVE(
  JSON_SET(
    JSON_REMOVE(`photographyPlan`, '$.sourceEditScriptId'),
    '$.editScriptId',
    `editScriptId`
  ),
  '$.sourceSnapshot',
  '$.strategyOutput'
)
WHERE `editScriptId` IS NOT NULL
  AND `photographyPlan` IS NOT NULL
  AND JSON_VALID(`photographyPlan`);

DELETE `clip`
FROM `project_clips` AS `clip`
LEFT JOIN `project_storyboards` AS `storyboard`
  ON `storyboard`.`clipId` = `clip`.`id`
WHERE `storyboard`.`id` IS NULL
  AND `clip`.`screenplay` IS NOT NULL
  AND JSON_VALID(`clip`.`screenplay`)
  AND JSON_UNQUOTE(JSON_EXTRACT(`clip`.`screenplay`, '$.source')) = 'edit_script';

CREATE UNIQUE INDEX `project_storyboards_editScriptId_key`
  ON `project_storyboards`(`editScriptId`);

CREATE INDEX `project_storyboards_editScriptId_idx`
  ON `project_storyboards`(`editScriptId`);

ALTER TABLE `project_storyboards`
  ADD CONSTRAINT `project_storyboards_editScriptId_fkey`
  FOREIGN KEY (`editScriptId`) REFERENCES `project_edit_scripts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
