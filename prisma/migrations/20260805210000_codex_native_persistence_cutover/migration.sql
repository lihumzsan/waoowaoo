-- Codex native persistence clean cutover.
--
-- Stop web and Temporal AgentThreadCoordinator processes before applying.
-- Existing Assistant conversations are intentionally discarded: Codex's
-- scope-local durable home becomes the only model-history authority.

CREATE TEMPORARY TABLE `_codex_native_persistence_cutover_blockers` (
  `blocker` VARCHAR(128) NOT NULL,
  CONSTRAINT `_codex_native_persistence_cutover_requires_drain`
    CHECK (`blocker` = 'OK')
);

INSERT INTO `_codex_native_persistence_cutover_blockers` (`blocker`)
SELECT 'SOURCE_RUNTIME_REVISION_SCHEMA_DIVERGED'
WHERE (
  SELECT COUNT(*)
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'project_assistant_threads'
    AND `column_name` = 'runtimeRevision'
) <> 1
UNION ALL
SELECT 'NON_TERMINAL_AGENT_TURN'
WHERE EXISTS (
  SELECT 1
  FROM `project_agent_turns`
  WHERE `status` IN ('queued', 'running', 'waiting_approval')
)
UNION ALL
SELECT 'UNSETTLED_AGENT_INTERACTION'
WHERE EXISTS (
  SELECT 1
  FROM `agent_turn_interactions`
  WHERE `status` IN ('pending', 'decided')
)
UNION ALL
SELECT 'THREAD_CLEAR_IN_PROGRESS'
WHERE EXISTS (
  SELECT 1
  FROM `project_assistant_threads`
  WHERE `clearRequestId` IS NOT NULL
);

UPDATE `follow_up_batches`
SET
  `status` = 'cancelled',
  `cancelledAt` = CURRENT_TIMESTAMP(3)
WHERE `status` IN ('pending', 'ready');

UPDATE `project_assistant_threads`
SET
  `runtimeThreadId` = NULL,
  `messagesJson` = JSON_ARRAY(),
  `planJson` = NULL;

ALTER TABLE `project_assistant_threads`
  DROP COLUMN `runtimeRevision`;

DROP TEMPORARY TABLE `_codex_native_persistence_cutover_blockers`;
