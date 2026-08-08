-- Incompatible cutover: drain Temporal workflows before applying this migration,
-- then deploy web and workers that understand only wao.failure.v2.

UPDATE `project_agent_turns`
SET `failure` = JSON_OBJECT(
  'version', 2,
  'native', JSON_OBJECT(
    'name', 'LegacyFailure',
    'message', JSON_UNQUOTE(JSON_EXTRACT(`failure`, '$.message')),
    'code', JSON_UNQUOTE(JSON_EXTRACT(`failure`, '$.code')),
    'statusCode', NULL,
    'requestId', NULL,
    'metadata', NULL,
    'cause', NULL
  ),
  'interpretation', JSON_OBJECT(
    'code', JSON_UNQUOTE(JSON_EXTRACT(`failure`, '$.code')),
    'details', JSON_EXTRACT(`failure`, '$.details')
  ),
  'context', JSON_EXTRACT(`failure`, '$.origin'),
  'recovery', JSON_OBJECT(
    'operation', NULL,
    'effect', 'unknown',
    'taskReplay', 'forbidden',
    'attempts', 1
  ),
  'frames', JSON_ARRAY()
)
WHERE JSON_EXTRACT(`failure`, '$.version') = 1;

UPDATE `tasks`
SET `failure` = JSON_OBJECT(
  'version', 2,
  'native', JSON_OBJECT(
    'name', 'LegacyFailure',
    'message', JSON_UNQUOTE(JSON_EXTRACT(`failure`, '$.message')),
    'code', JSON_UNQUOTE(JSON_EXTRACT(`failure`, '$.code')),
    'statusCode', NULL,
    'requestId', NULL,
    'metadata', NULL,
    'cause', NULL
  ),
  'interpretation', JSON_OBJECT(
    'code', JSON_UNQUOTE(JSON_EXTRACT(`failure`, '$.code')),
    'details', JSON_EXTRACT(`failure`, '$.details')
  ),
  'context', JSON_EXTRACT(`failure`, '$.origin'),
  'recovery', JSON_OBJECT(
    'operation', NULL,
    'effect', 'unknown',
    'taskReplay', 'forbidden',
    'attempts', 1
  ),
  'frames', JSON_ARRAY()
)
WHERE JSON_EXTRACT(`failure`, '$.version') = 1;

-- Provider checkpoints may carry the same failure both at output.failure and
-- inside routeAttempts[*].failure. Rebuild route arrays in ordinal order.
SET @failure_record_group_concat_max_len = @@SESSION.group_concat_max_len;
SET SESSION group_concat_max_len = 1048576;

UPDATE `task_execution_checkpoints` AS `checkpoint`
JOIN (
  SELECT
    `source`.`id`,
    CAST(CONCAT(
      '[',
      GROUP_CONCAT(
        CASE
          WHEN JSON_EXTRACT(`route`.`item`, '$.failure.version') = 1 THEN JSON_SET(
            JSON_SET(
              `route`.`item`,
              '$.state',
              CASE
                WHEN JSON_UNQUOTE(JSON_EXTRACT(`route`.`item`, '$.state')) = 'retryable_rejected'
                  THEN 'replay_authorized'
                ELSE JSON_UNQUOTE(JSON_EXTRACT(`route`.`item`, '$.state'))
              END
            ),
            '$.failure',
            JSON_OBJECT(
              'version', 2,
              'native', JSON_OBJECT(
                'name', 'LegacyFailure',
                'message', JSON_UNQUOTE(JSON_EXTRACT(`route`.`item`, '$.failure.message')),
                'code', JSON_UNQUOTE(JSON_EXTRACT(`route`.`item`, '$.failure.code')),
                'statusCode', NULL,
                'requestId', NULL,
                'metadata', NULL,
                'cause', NULL
              ),
              'interpretation', JSON_OBJECT(
                'code', JSON_UNQUOTE(JSON_EXTRACT(`route`.`item`, '$.failure.code')),
                'details', JSON_EXTRACT(`route`.`item`, '$.failure.details')
              ),
              'context', JSON_EXTRACT(`route`.`item`, '$.failure.origin'),
              'recovery', JSON_OBJECT(
                'operation', NULL,
                'effect', 'unknown',
                'taskReplay', 'forbidden',
                'attempts', 1
              ),
              'frames', JSON_ARRAY()
            )
          )
          WHEN JSON_UNQUOTE(JSON_EXTRACT(`route`.`item`, '$.state')) = 'retryable_rejected'
            THEN JSON_SET(`route`.`item`, '$.state', 'replay_authorized')
          ELSE `route`.`item`
        END
        ORDER BY `route`.`ordinality` SEPARATOR ','
      ),
      ']'
    ) AS JSON) AS `routeAttempts`
  FROM `task_execution_checkpoints` AS `source`
  JOIN JSON_TABLE(
    `source`.`output`,
    '$.routeAttempts[*]' COLUMNS (
      `ordinality` FOR ORDINALITY,
      `item` JSON PATH '$'
    )
  ) AS `route`
  GROUP BY `source`.`id`
) AS `rebuilt` ON `rebuilt`.`id` = `checkpoint`.`id`
SET `checkpoint`.`output` = JSON_SET(
  `checkpoint`.`output`,
  '$.routeAttempts',
  `rebuilt`.`routeAttempts`
);

UPDATE `task_execution_checkpoints`
SET `state` = 'replay_authorized'
WHERE `state` = 'retryable_rejected';

UPDATE `task_execution_checkpoints`
SET `output` = JSON_SET(
  `output`,
  '$.failure',
  JSON_OBJECT(
    'version', 2,
    'native', JSON_OBJECT(
      'name', 'LegacyFailure',
      'message', JSON_UNQUOTE(JSON_EXTRACT(`output`, '$.failure.message')),
      'code', JSON_UNQUOTE(JSON_EXTRACT(`output`, '$.failure.code')),
      'statusCode', NULL,
      'requestId', NULL,
      'metadata', NULL,
      'cause', NULL
    ),
    'interpretation', JSON_OBJECT(
      'code', JSON_UNQUOTE(JSON_EXTRACT(`output`, '$.failure.code')),
      'details', JSON_EXTRACT(`output`, '$.failure.details')
    ),
    'context', JSON_EXTRACT(`output`, '$.failure.origin'),
    'recovery', JSON_OBJECT(
      'operation', NULL,
      'effect', 'unknown',
      'taskReplay', 'forbidden',
      'attempts', 1
    ),
    'frames', JSON_ARRAY()
  )
)
WHERE JSON_EXTRACT(`output`, '$.failure.version') = 1;

UPDATE `task_execution_checkpoints`
SET `output` = JSON_SET(
  `output`,
  '$.failure.failure',
  JSON_OBJECT(
    'version', 2,
    'native', JSON_OBJECT(
      'name', 'LegacyFailure',
      'message', JSON_UNQUOTE(JSON_EXTRACT(`output`, '$.failure.failure.message')),
      'code', JSON_UNQUOTE(JSON_EXTRACT(`output`, '$.failure.failure.code')),
      'statusCode', NULL,
      'requestId', NULL,
      'metadata', NULL,
      'cause', NULL
    ),
    'interpretation', JSON_OBJECT(
      'code', JSON_UNQUOTE(JSON_EXTRACT(`output`, '$.failure.failure.code')),
      'details', JSON_EXTRACT(`output`, '$.failure.failure.details')
    ),
    'context', JSON_EXTRACT(`output`, '$.failure.failure.origin'),
    'recovery', JSON_OBJECT(
      'operation', NULL,
      'effect', 'unknown',
      'taskReplay', 'forbidden',
      'attempts', 1
    ),
    'frames', JSON_ARRAY()
  )
)
WHERE JSON_EXTRACT(`output`, '$.failure.failure.version') = 1;

SET SESSION group_concat_max_len = @failure_record_group_concat_max_len;
SET @failure_record_group_concat_max_len = NULL;

-- Fail the migration rather than leave a live v1 reader/record dual track.
CREATE TEMPORARY TABLE `_failure_record_v2_guard` (
  `id` INT NOT NULL PRIMARY KEY
);
INSERT INTO `_failure_record_v2_guard` (`id`) VALUES (1);
INSERT INTO `_failure_record_v2_guard` (`id`)
SELECT 1 FROM `project_agent_turns`
WHERE JSON_EXTRACT(`failure`, '$.version') = 1 LIMIT 1;
INSERT INTO `_failure_record_v2_guard` (`id`)
SELECT 1 FROM `tasks`
WHERE JSON_EXTRACT(`failure`, '$.version') = 1 LIMIT 1;
INSERT INTO `_failure_record_v2_guard` (`id`)
SELECT 1 FROM `task_execution_checkpoints`
WHERE JSON_EXTRACT(`output`, '$.failure.version') = 1
   OR JSON_EXTRACT(`output`, '$.failure.failure.version') = 1
LIMIT 1;
INSERT INTO `_failure_record_v2_guard` (`id`)
SELECT 1
FROM `task_execution_checkpoints` AS `checkpoint`
JOIN JSON_TABLE(
  `checkpoint`.`output`,
  '$.routeAttempts[*]' COLUMNS (`item` JSON PATH '$')
) AS `route`
WHERE JSON_EXTRACT(`route`.`item`, '$.failure.version') = 1
LIMIT 1;
INSERT INTO `_failure_record_v2_guard` (`id`)
SELECT 1 FROM `task_execution_checkpoints`
WHERE `state` = 'retryable_rejected'
LIMIT 1;
INSERT INTO `_failure_record_v2_guard` (`id`)
SELECT 1
FROM `task_execution_checkpoints` AS `checkpoint`
JOIN JSON_TABLE(
  `checkpoint`.`output`,
  '$.routeAttempts[*]' COLUMNS (`item` JSON PATH '$')
) AS `route`
WHERE JSON_UNQUOTE(JSON_EXTRACT(`route`.`item`, '$.state')) = 'retryable_rejected'
LIMIT 1;
DROP TEMPORARY TABLE `_failure_record_v2_guard`;
