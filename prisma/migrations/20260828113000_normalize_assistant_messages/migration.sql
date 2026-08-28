-- Hard-cut the product-visible Assistant transcript from one unbounded JSON
-- document to one durable row per UIMessage. Web and worker processes must be
-- stopped while this migration runs so no legacy writer can race the backfill.

CREATE TEMPORARY TABLE `_assistant_message_cutover_blockers` (
  `blocker` VARCHAR(128) NOT NULL,
  CONSTRAINT `_assistant_message_cutover_requires_valid_source`
    CHECK (`blocker` = 'OK')
);

INSERT INTO `_assistant_message_cutover_blockers` (`blocker`)
SELECT 'ACTIVE_TRANSCRIPT_NOT_ARRAY'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_threads`
  WHERE JSON_TYPE(`messagesJson`) <> 'ARRAY'
)
UNION ALL
SELECT 'ARCHIVE_TRANSCRIPT_NOT_ARRAY'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_thread_archives`
  WHERE JSON_TYPE(`messagesJson`) <> 'ARRAY'
)
UNION ALL
SELECT 'ACTIVE_MESSAGE_ID_INVALID'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_threads` AS `thread`
  JOIN JSON_TABLE(
    `thread`.`messagesJson`,
    '$[*]' COLUMNS (
      `ordinality` FOR ORDINALITY
    )
  ) AS `message`
  WHERE JSON_TYPE(JSON_EXTRACT(
          `thread`.`messagesJson`,
          CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), ']')
        )) <> 'OBJECT'
     OR JSON_TYPE(JSON_EXTRACT(
          `thread`.`messagesJson`,
          CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), '].id')
        )) <> 'STRING'
     OR CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(
          `thread`.`messagesJson`,
          CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), '].id')
        ))) NOT BETWEEN 1 AND 191
     OR JSON_UNQUOTE(JSON_EXTRACT(
          `thread`.`messagesJson`,
          CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), '].id')
        )) <> TRIM(JSON_UNQUOTE(JSON_EXTRACT(
          `thread`.`messagesJson`,
          CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), '].id')
        )))
)
UNION ALL
SELECT 'ARCHIVE_MESSAGE_ID_INVALID'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_thread_archives` AS `archive`
  JOIN JSON_TABLE(
    `archive`.`messagesJson`,
    '$[*]' COLUMNS (
      `ordinality` FOR ORDINALITY
    )
  ) AS `message`
  WHERE JSON_TYPE(JSON_EXTRACT(
          `archive`.`messagesJson`,
          CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), ']')
        )) <> 'OBJECT'
     OR JSON_TYPE(JSON_EXTRACT(
          `archive`.`messagesJson`,
          CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), '].id')
        )) <> 'STRING'
     OR CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(
          `archive`.`messagesJson`,
          CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), '].id')
        ))) NOT BETWEEN 1 AND 191
     OR JSON_UNQUOTE(JSON_EXTRACT(
          `archive`.`messagesJson`,
          CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), '].id')
        )) <> TRIM(JSON_UNQUOTE(JSON_EXTRACT(
          `archive`.`messagesJson`,
          CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), '].id')
        )))
)
UNION ALL
SELECT 'ACTIVE_MESSAGE_ID_DUPLICATE'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_threads` AS `thread`
  JOIN JSON_TABLE(
    `thread`.`messagesJson`,
    '$[*]' COLUMNS (
      `messageId` VARCHAR(191) PATH '$.id' NULL ON EMPTY NULL ON ERROR
    )
  ) AS `message`
  GROUP BY `thread`.`id`, `message`.`messageId`
  HAVING COUNT(*) > 1
)
UNION ALL
SELECT 'ARCHIVE_MESSAGE_ID_DUPLICATE'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_thread_archives` AS `archive`
  JOIN JSON_TABLE(
    `archive`.`messagesJson`,
    '$[*]' COLUMNS (
      `messageId` VARCHAR(191) PATH '$.id' NULL ON EMPTY NULL ON ERROR
    )
  ) AS `message`
  GROUP BY `archive`.`id`, `message`.`messageId`
  HAVING COUNT(*) > 1
);

ALTER TABLE `project_assistant_threads`
  ADD COLUMN `nextMessagePosition` INTEGER NOT NULL DEFAULT 1;

CREATE TABLE `project_assistant_messages` (
  `threadId` VARCHAR(191) NOT NULL,
  `messageId` VARCHAR(191) NOT NULL,
  `position` INTEGER NOT NULL,
  `messageJson` JSON NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_assistant_messages_threadId_position_key`(`threadId`, `position`),
  INDEX `project_assistant_messages_threadId_updatedAt_idx`(`threadId`, `updatedAt`),
  PRIMARY KEY (`threadId`, `messageId`),
  CONSTRAINT `project_assistant_messages_threadId_fkey`
    FOREIGN KEY (`threadId`) REFERENCES `project_assistant_threads`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_assistant_message_archives` (
  `archiveId` VARCHAR(191) NOT NULL,
  `messageId` VARCHAR(191) NOT NULL,
  `position` INTEGER NOT NULL,
  `messageJson` JSON NOT NULL,
  `revision` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `project_assistant_message_archives_archiveId_position_key`(`archiveId`, `position`),
  PRIMARY KEY (`archiveId`, `messageId`),
  CONSTRAINT `project_assistant_message_archives_archiveId_fkey`
    FOREIGN KEY (`archiveId`) REFERENCES `project_assistant_thread_archives`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `project_assistant_messages` (
  `threadId`,
  `messageId`,
  `position`,
  `messageJson`,
  `revision`,
  `createdAt`,
  `updatedAt`
)
SELECT
  `thread`.`id`,
  `message`.`messageId`,
  `message`.`ordinality`,
  JSON_EXTRACT(
    `thread`.`messagesJson`,
    CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), ']')
  ),
  0,
  `thread`.`createdAt`,
  `thread`.`updatedAt`
FROM `project_assistant_threads` AS `thread`
JOIN JSON_TABLE(
  `thread`.`messagesJson`,
  '$[*]' COLUMNS (
    `ordinality` FOR ORDINALITY,
    `messageId` VARCHAR(191) PATH '$.id' ERROR ON EMPTY ERROR ON ERROR
  )
) AS `message`;

UPDATE `project_assistant_threads`
SET `nextMessagePosition` = JSON_LENGTH(`messagesJson`) + 1;

INSERT INTO `project_assistant_message_archives` (
  `archiveId`,
  `messageId`,
  `position`,
  `messageJson`,
  `revision`,
  `createdAt`,
  `updatedAt`
)
SELECT
  `archive`.`id`,
  `message`.`messageId`,
  `message`.`ordinality`,
  JSON_EXTRACT(
    `archive`.`messagesJson`,
    CONCAT('$[', CAST(`message`.`ordinality` - 1 AS CHAR), ']')
  ),
  0,
  `archive`.`threadCreatedAt`,
  `archive`.`threadUpdatedAt`
FROM `project_assistant_thread_archives` AS `archive`
JOIN JSON_TABLE(
  `archive`.`messagesJson`,
  '$[*]' COLUMNS (
    `ordinality` FOR ORDINALITY,
    `messageId` VARCHAR(191) PATH '$.id' ERROR ON EMPTY ERROR ON ERROR
  )
) AS `message`;

INSERT INTO `_assistant_message_cutover_blockers` (`blocker`)
SELECT 'ACTIVE_MESSAGE_BACKFILL_COUNT_DIVERGED'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_threads` AS `thread`
  LEFT JOIN (
    SELECT `threadId`, COUNT(*) AS `messageCount`
    FROM `project_assistant_messages`
    GROUP BY `threadId`
  ) AS `backfill` ON `backfill`.`threadId` = `thread`.`id`
  WHERE COALESCE(`backfill`.`messageCount`, 0) <> JSON_LENGTH(`thread`.`messagesJson`)
)
UNION ALL
SELECT 'ARCHIVE_MESSAGE_BACKFILL_COUNT_DIVERGED'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_thread_archives` AS `archive`
  LEFT JOIN (
    SELECT `archiveId`, COUNT(*) AS `messageCount`
    FROM `project_assistant_message_archives`
    GROUP BY `archiveId`
  ) AS `backfill` ON `backfill`.`archiveId` = `archive`.`id`
  WHERE COALESCE(`backfill`.`messageCount`, 0) <> JSON_LENGTH(`archive`.`messagesJson`)
)
UNION ALL
SELECT 'ACTIVE_MESSAGE_POSITION_DIVERGED'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_threads` AS `thread`
  LEFT JOIN (
    SELECT
      `threadId`,
      COUNT(*) AS `messageCount`,
      COALESCE(MAX(`position`), 0) AS `maxPosition`
    FROM `project_assistant_messages`
    GROUP BY `threadId`
  ) AS `backfill` ON `backfill`.`threadId` = `thread`.`id`
  WHERE COALESCE(`backfill`.`messageCount`, 0) <> COALESCE(`backfill`.`maxPosition`, 0)
     OR `thread`.`nextMessagePosition` <> COALESCE(`backfill`.`maxPosition`, 0) + 1
);

ALTER TABLE `project_assistant_threads`
  DROP COLUMN `messagesJson`;

ALTER TABLE `project_assistant_thread_archives`
  DROP COLUMN `messagesJson`;

DROP TEMPORARY TABLE `_assistant_message_cutover_blockers`;
