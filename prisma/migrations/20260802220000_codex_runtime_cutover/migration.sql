-- Codex runtime clean cutover.
--
-- Drain the old web process and Temporal AgentThreadCoordinator before this
-- migration. Long-running media Tasks and FollowUpBatch rows remain valid:
-- the cutover preserves their schema and switches only the terminal notifier
-- to AssistantRuntime. MySQL DDL is non-transactional, so every source-schema
-- and Agent drain assertion happens before the first ALTER TABLE.

CREATE TEMPORARY TABLE `_codex_runtime_cutover_blockers` (
  `blocker` VARCHAR(128) NOT NULL,
  CONSTRAINT `_codex_runtime_cutover_requires_drain`
    CHECK (`blocker` = 'OK')
);

INSERT INTO `_codex_runtime_cutover_blockers` (`blocker`)
SELECT 'SOURCE_THREAD_SCHEMA_DIVERGED'
WHERE (
  SELECT COUNT(*)
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'project_assistant_threads'
    AND `column_name` IN ('modelHistoryJson', 'modelHistoryVersion')
) <> 2
UNION ALL
SELECT 'SOURCE_TURN_SCHEMA_DIVERGED'
WHERE (
  SELECT COUNT(*)
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'project_agent_turns'
    AND `column_name` = 'modelHistoryBaseVersion'
) <> 1
UNION ALL
SELECT 'SOURCE_INTERACTION_SCHEMA_DIVERGED'
WHERE (
  SELECT COUNT(*)
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'agent_turn_interactions'
    AND `column_name` = 'runState'
) <> 1
UNION ALL
SELECT 'SOURCE_ARCHIVE_SCHEMA_DIVERGED'
WHERE (
  SELECT COUNT(*)
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'project_assistant_thread_archives'
    AND `column_name` = 'modelHistoryJson'
) <> 1
UNION ALL
SELECT 'PARTIAL_CODEX_RUNTIME_SCHEMA_PRESENT'
WHERE EXISTS (
  SELECT 1
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND (
      (`table_name` = 'project_assistant_threads' AND `column_name` = 'runtimeThreadId')
      OR (`table_name` = 'project_agent_turns' AND `column_name` = 'runtimeTurnId')
      OR (`table_name` = 'agent_turn_interactions' AND `column_name` = 'runtimeRequestId')
      OR (`table_name` = 'project_assistant_thread_archives' AND `column_name` = 'runtimeThreadId')
    )
);

INSERT INTO `_codex_runtime_cutover_blockers` (`blocker`)
SELECT 'NON_TERMINAL_AGENT_TURN'
WHERE EXISTS (
  SELECT 1
  FROM `project_agent_turns`
  WHERE `status` IN ('queued', 'running', 'waiting_approval')
)
UNION ALL
SELECT 'PENDING_AGENT_INTERACTION'
WHERE EXISTS (
  SELECT 1
  FROM `agent_turn_interactions`
  WHERE `status` IN ('pending', 'approved', 'rejected')
);

ALTER TABLE `project_assistant_threads`
  ADD COLUMN `runtimeThreadId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `project_assistant_threads_runtimeThreadId_key` (`runtimeThreadId`),
  DROP COLUMN `modelHistoryJson`,
  DROP COLUMN `modelHistoryVersion`;

ALTER TABLE `project_agent_turns`
  ADD COLUMN `runtimeTurnId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `project_agent_turns_runtimeTurnId_key` (`runtimeTurnId`),
  DROP COLUMN `modelHistoryBaseVersion`;

ALTER TABLE `agent_turn_interactions`
  ADD COLUMN `runtimeRequestId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `agent_turn_interactions_turnId_runtimeRequestId_key`
    (`turnId`, `runtimeRequestId`),
  DROP COLUMN `runState`;

ALTER TABLE `project_assistant_thread_archives`
  ADD COLUMN `runtimeThreadId` VARCHAR(191) NULL,
  DROP COLUMN `modelHistoryJson`;

DROP TEMPORARY TABLE `_codex_runtime_cutover_blockers`;
