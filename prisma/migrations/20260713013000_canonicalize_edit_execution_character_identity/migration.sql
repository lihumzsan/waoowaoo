-- Convert the one persisted legacy execution-plan shape from character names to canonical ids.
-- The guard deliberately fails the migration when any legacy name cannot be resolved exactly.

CREATE TEMPORARY TABLE `_edit_execution_character_identity_guard` (
  `ok` TINYINT NOT NULL CHECK (`ok` = 1)
);

INSERT INTO `_edit_execution_character_identity_guard` (`ok`)
SELECT 0
FROM `project_edit_shot_execution_plans` AS `execution_plan`
INNER JOIN `project_edit_scripts` AS `edit_script`
  ON `edit_script`.`id` = `execution_plan`.`editScriptId`
INNER JOIN JSON_TABLE(
  `execution_plan`.`executionPlanJson`,
  '$.shots[*]' COLUMNS (
    `characters` JSON PATH '$.blocking.characters'
  )
) AS `execution_shot`
INNER JOIN JSON_TABLE(
  `execution_shot`.`characters`,
  '$[*]' COLUMNS (
    `characterName` VARCHAR(191) PATH '$.name'
  )
) AS `execution_character`
WHERE `execution_character`.`characterName` IS NULL
   OR JSON_SEARCH(
     `edit_script`.`corePlanJson`,
     'one',
     `execution_character`.`characterName`,
     NULL,
     '$.shots[*].characters[*].name'
   ) IS NULL
LIMIT 1;

DROP TEMPORARY TABLE `_edit_execution_character_identity_guard`;

SET @previous_cte_max_recursion_depth = @@SESSION.cte_max_recursion_depth;
SET SESSION cte_max_recursion_depth = 10000;

WITH RECURSIVE `rewritten_execution_plans` AS (
  SELECT
    `execution_plan`.`id`,
    `edit_script`.`corePlanJson`,
    `execution_plan`.`executionPlanJson` AS `rewrittenJson`,
    0 AS `shotIndex`,
    0 AS `characterIndex`
  FROM `project_edit_shot_execution_plans` AS `execution_plan`
  INNER JOIN `project_edit_scripts` AS `edit_script`
    ON `edit_script`.`id` = `execution_plan`.`editScriptId`

  UNION ALL

  SELECT
    `current`.`id`,
    `current`.`corePlanJson`,
    CASE
      WHEN JSON_LENGTH(
        JSON_EXTRACT(
          `current`.`rewrittenJson`,
          CONCAT('$.shots[', `current`.`shotIndex`, '].blocking.characters')
        )
      ) = 0 THEN `current`.`rewrittenJson`
      ELSE JSON_SET(
        JSON_REMOVE(
          `current`.`rewrittenJson`,
          CONCAT(
            '$.shots[', `current`.`shotIndex`, '].blocking.characters[',
            `current`.`characterIndex`, '].name'
          )
        ),
        CONCAT(
          '$.shots[', `current`.`shotIndex`, '].blocking.characters[',
          `current`.`characterIndex`, '].characterId'
        ),
        JSON_UNQUOTE(JSON_EXTRACT(
          `current`.`corePlanJson`,
          REPLACE(
            JSON_UNQUOTE(JSON_SEARCH(
              `current`.`corePlanJson`,
              'one',
              JSON_UNQUOTE(JSON_EXTRACT(
                `current`.`rewrittenJson`,
                CONCAT(
                  '$.shots[', `current`.`shotIndex`, '].blocking.characters[',
                  `current`.`characterIndex`, '].name'
                )
              )),
              NULL,
              '$.shots[*].characters[*].name'
            )),
            '.name',
            '.characterId'
          )
        ))
      )
    END AS `rewrittenJson`,
    CASE
      WHEN `current`.`characterIndex` + 1 < JSON_LENGTH(
        JSON_EXTRACT(
          `current`.`rewrittenJson`,
          CONCAT('$.shots[', `current`.`shotIndex`, '].blocking.characters')
        )
      ) THEN `current`.`shotIndex`
      ELSE `current`.`shotIndex` + 1
    END AS `shotIndex`,
    CASE
      WHEN `current`.`characterIndex` + 1 < JSON_LENGTH(
        JSON_EXTRACT(
          `current`.`rewrittenJson`,
          CONCAT('$.shots[', `current`.`shotIndex`, '].blocking.characters')
        )
      ) THEN `current`.`characterIndex` + 1
      ELSE 0
    END AS `characterIndex`
  FROM `rewritten_execution_plans` AS `current`
  WHERE `current`.`shotIndex` < JSON_LENGTH(JSON_EXTRACT(`current`.`rewrittenJson`, '$.shots'))
),
`final_execution_plans` AS (
  SELECT `id`, `rewrittenJson`
  FROM `rewritten_execution_plans`
  WHERE `shotIndex` = JSON_LENGTH(JSON_EXTRACT(`rewrittenJson`, '$.shots'))
)
UPDATE `project_edit_shot_execution_plans` AS `execution_plan`
INNER JOIN `final_execution_plans` AS `final_plan`
  ON `final_plan`.`id` = `execution_plan`.`id`
SET `execution_plan`.`executionPlanJson` = `final_plan`.`rewrittenJson`;

CREATE TEMPORARY TABLE `_edit_execution_character_identity_post_guard` (
  `ok` TINYINT NOT NULL CHECK (`ok` = 1)
);

INSERT INTO `_edit_execution_character_identity_post_guard` (`ok`)
SELECT 0
FROM `project_edit_shot_execution_plans` AS `execution_plan`
INNER JOIN JSON_TABLE(
  `execution_plan`.`executionPlanJson`,
  '$.shots[*]' COLUMNS (
    `characters` JSON PATH '$.blocking.characters'
  )
) AS `execution_shot`
INNER JOIN JSON_TABLE(
  `execution_shot`.`characters`,
  '$[*]' COLUMNS (
    `characterId` VARCHAR(191) PATH '$.characterId',
    `legacyName` VARCHAR(191) PATH '$.name'
  )
) AS `execution_character`
WHERE `execution_character`.`characterId` IS NULL
   OR `execution_character`.`legacyName` IS NOT NULL
LIMIT 1;

DROP TEMPORARY TABLE `_edit_execution_character_identity_post_guard`;

SET SESSION cte_max_recursion_depth = @previous_cte_max_recursion_depth;
