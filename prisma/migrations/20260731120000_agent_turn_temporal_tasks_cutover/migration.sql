-- B+ clean cutover:
--   * Thread/Turn is the only Agent lifecycle.
--   * Temporal is the only durable Task/Operation execution permission.
--   * FollowUpBatch is the only Task -> Agent continuation.
--
-- MySQL DDL is not transactional. Stop the old web process, Bull workers and
-- Outbox dispatcher, run `npm run db:bplus-cutover-preflight`, then apply this
-- migration before starting the B+ application or Temporal workers.

CREATE TEMPORARY TABLE `_bplus_cutover_blockers` (
  `blocker` VARCHAR(128) NOT NULL,
  CONSTRAINT `_bplus_cutover_requires_drain`
    CHECK (`blocker` = 'OK')
);

-- Refuse an unknown or partially-applied source schema before reading any old
-- lifecycle table or performing any durable DDL.
INSERT INTO `_bplus_cutover_blockers` (`blocker`)
SELECT 'LEGACY_TABLE_SET_DIVERGED'
WHERE (
  SELECT COUNT(*)
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` IN (
      'user',
      'tasks',
      'operation_executions',
      'approval_grants',
      'creative_resources',
      'project_assistant_threads',
      'project_agent_runs',
      'project_agent_waits',
      'project_agent_activities',
      'project_agent_interruptions',
      'project_agent_execution_handoffs',
      'project_agent_continuation_checkpoints',
      'project_agent_events',
      'outbox_commands'
    )
) <> 14
UNION ALL
SELECT 'PARTIAL_BPLUS_TABLES_PRESENT'
WHERE EXISTS (
  SELECT 1
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` IN (
      'project_agent_turns',
      'agent_tool_effects',
      'agent_turn_interactions',
      'follow_up_batches',
      'follow_up_batch_members'
    )
)
UNION ALL
SELECT 'LEGACY_THREAD_COLUMNS_DIVERGED'
WHERE (
  SELECT COUNT(*)
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'project_assistant_threads'
    AND `column_name` IN (
      'pendingModelHistoryJson',
      'pendingModelHistorySegmentId',
      'pendingModelHistoryBaseVersion',
      'pendingModelHistoryReady'
    )
) <> 4
UNION ALL
SELECT 'LEGACY_TASK_COLUMNS_DIVERGED'
WHERE (
  SELECT COUNT(*)
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'tasks'
    AND `column_name` IN (
      'priority',
      'batchKey',
      'externalId',
      'heartbeatAt',
      'enqueuedAt',
      'enqueueAttempts',
      'lastEnqueueError'
    )
) <> 7
UNION ALL
SELECT 'LEGACY_CREATIVE_RESOURCE_COLUMNS_DIVERGED'
WHERE (
  SELECT COUNT(*)
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'creative_resources'
    AND `column_name` = 'executionSegmentId'
) <> 1
UNION ALL
SELECT 'PARTIAL_OPERATION_EXECUTION_COLUMNS_PRESENT'
WHERE EXISTS (
  SELECT 1
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'operation_executions'
    AND `column_name` IN (
      'executionKind',
      'commandId',
      'payloadHash',
      'contractRevision',
      'normalizedInput',
      'contextSnapshot',
      'source'
    )
);

-- Drain guard. No row is repaired, cancelled, retried or deleted here.
INSERT INTO `_bplus_cutover_blockers` (`blocker`)
SELECT 'NON_TERMINAL_TASK'
WHERE EXISTS (
  SELECT 1
  FROM `tasks`
  WHERE `status` NOT IN ('completed', 'failed', 'canceled', 'dismissed')
)
UNION ALL
SELECT 'NON_TERMINAL_AGENT_RUN'
WHERE EXISTS (
  SELECT 1
  FROM `project_agent_runs`
  WHERE `status` NOT IN ('completed', 'failed', 'cancelled')
)
UNION ALL
SELECT 'NON_TERMINAL_AGENT_WAIT'
WHERE EXISTS (
  SELECT 1
  FROM `project_agent_waits`
  WHERE `status` NOT IN ('followed', 'abandoned')
)
UNION ALL
SELECT 'NON_TERMINAL_AGENT_ACTIVITY'
WHERE EXISTS (
  SELECT 1
  FROM `project_agent_activities`
  WHERE `status` NOT IN ('completed', 'failed', 'cancelled')
)
UNION ALL
SELECT 'PENDING_AGENT_INTERRUPTION'
WHERE EXISTS (
  SELECT 1
  FROM `project_agent_interruptions`
  WHERE `status` NOT IN ('consumed', 'superseded')
)
UNION ALL
SELECT 'PREPARED_EXECUTION_HANDOFF'
WHERE EXISTS (
  SELECT 1
  FROM `project_agent_execution_handoffs`
  WHERE `status` <> 'settled'
)
UNION ALL
SELECT 'RUNNING_CONTINUATION_CHECKPOINT'
WHERE EXISTS (
  SELECT 1
  FROM `project_agent_continuation_checkpoints`
  WHERE `status` <> 'settled'
)
UNION ALL
SELECT 'UNDELIVERED_OUTBOX_COMMAND'
WHERE EXISTS (
  SELECT 1
  FROM `outbox_commands`
  WHERE `acceptedAt` IS NULL
    AND `deadAt` IS NULL
)
UNION ALL
SELECT 'INCOMPLETE_OPERATION_EXECUTION'
WHERE EXISTS (
  SELECT 1
  FROM `operation_executions`
  WHERE `status` <> 'completed'
)
UNION ALL
SELECT 'UNCONSUMED_APPROVAL_GRANT'
WHERE EXISTS (
  SELECT 1
  FROM `approval_grants`
  WHERE `consumedAt` IS NULL
    AND `revokedAt` IS NULL
)
UNION ALL
SELECT 'PENDING_MODEL_HISTORY_CHECKPOINT'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_threads`
  WHERE `pendingModelHistoryJson` IS NOT NULL
     OR `pendingModelHistorySegmentId` IS NOT NULL
     OR `pendingModelHistoryBaseVersion` IS NOT NULL
     OR `pendingModelHistoryReady` = TRUE
);

-- This table was historically introduced through schema push without a
-- migration. Create it only for that known drift; every new B+ table below
-- intentionally fails if a partial copy already exists.
CREATE TABLE IF NOT EXISTS `project_assistant_thread_archives` (
  `id` VARCHAR(191) NOT NULL,
  `threadId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NULL,
  `assistantId` VARCHAR(191) NOT NULL,
  `scopeRef` VARCHAR(191) NOT NULL,
  `messagesJson` JSON NOT NULL,
  `modelHistoryJson` JSON NOT NULL,
  `threadCreatedAt` DATETIME(3) NOT NULL,
  `threadUpdatedAt` DATETIME(3) NOT NULL,
  `archivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_assistant_thread_archives_threadId_key`(`threadId`),
  INDEX `project_assistant_thread_archives_projectId_userId_archivedA_idx`(
    `projectId`,
    `userId`,
    `archivedAt`
  ),
  INDEX `project_assistant_thread_archives_userId_archivedAt_idx`(
    `userId`,
    `archivedAt`
  ),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `_bplus_cutover_blockers` (`blocker`)
SELECT 'ARCHIVE_SCHEMA_DIVERGED'
WHERE (
  SELECT COUNT(*)
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'project_assistant_thread_archives'
    AND `column_name` IN (
      'id',
      'threadId',
      'projectId',
      'userId',
      'episodeId',
      'assistantId',
      'scopeRef',
      'messagesJson',
      'modelHistoryJson',
      'threadCreatedAt',
      'threadUpdatedAt',
      'archivedAt'
    )
) <> 12
UNION ALL
SELECT 'DUPLICATE_ARCHIVE_THREAD'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_thread_archives`
  GROUP BY `threadId`
  HAVING COUNT(*) > 1
)
UNION ALL
SELECT 'ARCHIVE_USER_ID_FK_INCOMPATIBLE'
WHERE NOT EXISTS (
  SELECT 1
  FROM `information_schema`.`columns` AS archive_column
  INNER JOIN `information_schema`.`columns` AS user_column
    ON user_column.`table_schema` = archive_column.`table_schema`
   AND user_column.`table_name` = 'user'
   AND user_column.`column_name` = 'id'
  WHERE archive_column.`table_schema` = DATABASE()
    AND archive_column.`table_name` = 'project_assistant_thread_archives'
    AND archive_column.`column_name` = 'userId'
    AND LOWER(archive_column.`column_type`) = LOWER(user_column.`column_type`)
    AND archive_column.`character_set_name` = user_column.`character_set_name`
    AND archive_column.`collation_name` = user_column.`collation_name`
    AND archive_column.`is_nullable` = 'NO'
    AND user_column.`is_nullable` = 'NO'
)
UNION ALL
SELECT 'ORPHAN_ARCHIVE_USER'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_thread_archives` AS archive
  LEFT JOIN `user` AS owner
    ON owner.`id` = archive.`userId`
  WHERE owner.`id` IS NULL
);

SET @bplus_archive_thread_index_sql = IF(
  (
    SELECT COUNT(*)
    FROM `information_schema`.`statistics`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'project_assistant_thread_archives'
      AND `index_name` = 'project_assistant_thread_archives_threadId_key'
      AND `non_unique` = 0
  ) = 1,
  'SELECT 1',
  'CREATE UNIQUE INDEX `project_assistant_thread_archives_threadId_key` ON `project_assistant_thread_archives` (`threadId`)'
);
PREPARE bplus_archive_thread_index_stmt
  FROM @bplus_archive_thread_index_sql;
EXECUTE bplus_archive_thread_index_stmt;
DEALLOCATE PREPARE bplus_archive_thread_index_stmt;

SET @bplus_archive_project_index_sql = IF(
  (
    SELECT COUNT(*)
    FROM `information_schema`.`statistics`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'project_assistant_thread_archives'
      AND `index_name` = 'project_assistant_thread_archives_projectId_userId_archivedA_idx'
  ) = 3,
  'SELECT 1',
  'CREATE INDEX `project_assistant_thread_archives_projectId_userId_archivedA_idx` ON `project_assistant_thread_archives` (`projectId`, `userId`, `archivedAt`)'
);
PREPARE bplus_archive_project_index_stmt
  FROM @bplus_archive_project_index_sql;
EXECUTE bplus_archive_project_index_stmt;
DEALLOCATE PREPARE bplus_archive_project_index_stmt;

SET @bplus_archive_user_index_sql = IF(
  (
    SELECT COUNT(*)
    FROM `information_schema`.`statistics`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'project_assistant_thread_archives'
      AND `index_name` = 'project_assistant_thread_archives_userId_archivedAt_idx'
  ) = 2,
  'SELECT 1',
  'CREATE INDEX `project_assistant_thread_archives_userId_archivedAt_idx` ON `project_assistant_thread_archives` (`userId`, `archivedAt`)'
);
PREPARE bplus_archive_user_index_stmt
  FROM @bplus_archive_user_index_sql;
EXECUTE bplus_archive_user_index_stmt;
DEALLOCATE PREPARE bplus_archive_user_index_stmt;

SET @bplus_archive_user_fk_sql = IF(
  (
    SELECT COUNT(*)
    FROM `information_schema`.`table_constraints`
    WHERE `constraint_schema` = DATABASE()
      AND `table_name` = 'project_assistant_thread_archives'
      AND `constraint_name` = 'project_assistant_thread_archives_userId_fkey'
      AND `constraint_type` = 'FOREIGN KEY'
  ) = 1,
  'SELECT 1',
  'ALTER TABLE `project_assistant_thread_archives` ADD CONSTRAINT `project_assistant_thread_archives_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
);
PREPARE bplus_archive_user_fk_stmt
  FROM @bplus_archive_user_fk_sql;
EXECUTE bplus_archive_user_fk_stmt;
DEALLOCATE PREPARE bplus_archive_user_fk_stmt;

-- Extend the existing approved execution ledger into the single durable
-- OperationExecution authority. Existing completed rows remain valid
-- approved-plan history through the default executionKind.
ALTER TABLE `operation_executions`
  ADD COLUMN `commandId` VARCHAR(191) NULL,
  ADD COLUMN `contextSnapshot` JSON NULL,
  ADD COLUMN `contractRevision` VARCHAR(128) NULL,
  ADD COLUMN `executionKind` VARCHAR(32) NOT NULL DEFAULT 'approved_plan',
  ADD COLUMN `normalizedInput` JSON NULL,
  ADD COLUMN `payloadHash` VARCHAR(64) NULL,
  ADD COLUMN `source` VARCHAR(64) NULL,
  MODIFY `planSnapshotId` VARCHAR(191) NULL,
  MODIFY `approvalGrantId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `operation_executions_commandId_key`
  ON `operation_executions`(`commandId`);

CREATE TABLE `project_agent_turns` (
  `id` VARCHAR(191) NOT NULL,
  `threadId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NULL,
  `sourceKind` VARCHAR(32) NOT NULL,
  `sourceId` VARCHAR(191) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `requestId` VARCHAR(128) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
  `attempt` INTEGER NOT NULL DEFAULT 0,
  `executionOwnerId` VARCHAR(191) NULL,
  `userMessageJson` JSON NULL,
  `contextJson` JSON NOT NULL,
  `modelHistoryBaseVersion` INTEGER NULL,
  `assistantMessageId` VARCHAR(191) NULL,
  `stopReason` VARCHAR(64) NULL,
  `errorCode` VARCHAR(128) NULL,
  `errorMessage` TEXT NULL,
  `cancelRequestId` VARCHAR(128) NULL,
  `cancelReason` TEXT NULL,
  `startedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `project_agent_turns_threadId_status_createdAt_idx`(
    `threadId`,
    `status`,
    `createdAt`
  ),
  INDEX `project_agent_turns_projectId_userId_status_createdAt_idx`(
    `projectId`,
    `userId`,
    `status`,
    `createdAt`
  ),
  UNIQUE INDEX `project_agent_turns_threadId_sourceKind_sourceId_key`(
    `threadId`,
    `sourceKind`,
    `sourceId`
  ),
  PRIMARY KEY (`id`),
  CONSTRAINT `project_agent_turns_threadId_fkey`
    FOREIGN KEY (`threadId`) REFERENCES `project_assistant_threads`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `agent_tool_effects` (
  `id` VARCHAR(191) NOT NULL,
  `turnId` VARCHAR(191) NOT NULL,
  `callId` VARCHAR(191) NOT NULL,
  `operationId` VARCHAR(128) NOT NULL,
  `contractRevision` VARCHAR(128) NOT NULL,
  `inputHash` VARCHAR(64) NOT NULL,
  `resultJson` JSON NOT NULL,
  `completedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `agent_tool_effects_operationId_completedAt_idx`(
    `operationId`,
    `completedAt`
  ),
  UNIQUE INDEX `agent_tool_effects_turnId_callId_key`(`turnId`, `callId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `agent_tool_effects_turnId_fkey`
    FOREIGN KEY (`turnId`) REFERENCES `project_agent_turns`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `agent_turn_interactions` (
  `id` VARCHAR(191) NOT NULL,
  `turnId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `payloadJson` JSON NOT NULL,
  `runState` LONGTEXT NULL,
  `responseJson` JSON NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `resolvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `agent_turn_interactions_turnId_status_createdAt_idx`(
    `turnId`,
    `status`,
    `createdAt`
  ),
  PRIMARY KEY (`id`),
  CONSTRAINT `agent_turn_interactions_turnId_fkey`
    FOREIGN KEY (`turnId`) REFERENCES `project_agent_turns`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `follow_up_batches` (
  `id` VARCHAR(191) NOT NULL,
  `executionKey` VARCHAR(191) NOT NULL,
  `threadId` VARCHAR(191) NOT NULL,
  `originTurnId` VARCHAR(191) NOT NULL,
  `callId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NULL,
  `assistantId` VARCHAR(64) NOT NULL,
  `operationId` VARCHAR(128) NOT NULL,
  `contextJson` JSON NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `readyByTaskId` VARCHAR(191) NULL,
  `readyByTerminalEventId` INTEGER NULL,
  `notifiedTurnId` VARCHAR(191) NULL,
  `readyAt` DATETIME(3) NULL,
  `notifiedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `follow_up_batches_executionKey_key`(`executionKey`),
  INDEX `follow_up_batches_threadId_status_createdAt_idx`(
    `threadId`,
    `status`,
    `createdAt`
  ),
  INDEX `follow_up_batches_projectId_userId_status_createdAt_idx`(
    `projectId`,
    `userId`,
    `status`,
    `createdAt`
  ),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `follow_up_batch_members` (
  `batchId` VARCHAR(191) NOT NULL,
  `taskId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `terminalEventId` INTEGER NULL,
  `settledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `follow_up_batch_members_taskId_status_batchId_idx`(
    `taskId`,
    `status`,
    `batchId`
  ),
  PRIMARY KEY (`batchId`, `taskId`),
  CONSTRAINT `follow_up_batch_members_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `follow_up_batches`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `follow_up_batch_members_taskId_fkey`
    FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Destructive DDL is deliberately last. Every fact below has been drained and
-- its replacement authority already exists.
DROP INDEX `tasks_batchKey_idx` ON `tasks`;
DROP INDEX `tasks_heartbeatAt_idx` ON `tasks`;

ALTER TABLE `tasks`
  DROP COLUMN `batchKey`,
  DROP COLUMN `enqueueAttempts`,
  DROP COLUMN `enqueuedAt`,
  DROP COLUMN `externalId`,
  DROP COLUMN `heartbeatAt`,
  DROP COLUMN `lastEnqueueError`,
  DROP COLUMN `priority`;

ALTER TABLE `project_assistant_threads`
  DROP COLUMN `pendingModelHistoryBaseVersion`,
  DROP COLUMN `pendingModelHistoryJson`,
  DROP COLUMN `pendingModelHistoryReady`,
  DROP COLUMN `pendingModelHistorySegmentId`;

ALTER TABLE `creative_resources`
  DROP COLUMN `executionSegmentId`;

DROP TABLE `project_agent_continuation_checkpoints`;
DROP TABLE `project_agent_waits`;
DROP TABLE `project_agent_interruptions`;
DROP TABLE `project_agent_execution_handoffs`;
DROP TABLE `project_agent_activities`;
DROP TABLE `project_agent_events`;
DROP TABLE `project_agent_runs`;
DROP TABLE `outbox_commands`;

DROP TEMPORARY TABLE `_bplus_cutover_blockers`;
