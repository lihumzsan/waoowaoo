-- Keep the previously released B+ cutover migration immutable. This additive
-- migration upgrades both databases that already applied the cutover and fresh
-- databases whose schema was initialized from the current Prisma schema.

SET @add_archive_clear_request_id_sql = IF(
  (
    SELECT COUNT(*)
    FROM `information_schema`.`columns`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'project_assistant_thread_archives'
      AND `column_name` = 'clearRequestId'
  ) = 1,
  'SELECT 1',
  'ALTER TABLE `project_assistant_thread_archives` ADD COLUMN `clearRequestId` VARCHAR(128) NULL'
);
PREPARE add_archive_clear_request_id_stmt
  FROM @add_archive_clear_request_id_sql;
EXECUTE add_archive_clear_request_id_stmt;
DEALLOCATE PREPARE add_archive_clear_request_id_stmt;

SET @add_archive_cancelled_turn_ids_sql = IF(
  (
    SELECT COUNT(*)
    FROM `information_schema`.`columns`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'project_assistant_thread_archives'
      AND `column_name` = 'cancelledTurnIds'
  ) = 1,
  'SELECT 1',
  'ALTER TABLE `project_assistant_thread_archives` ADD COLUMN `cancelledTurnIds` JSON NULL'
);
PREPARE add_archive_cancelled_turn_ids_stmt
  FROM @add_archive_cancelled_turn_ids_sql;
EXECUTE add_archive_cancelled_turn_ids_stmt;
DEALLOCATE PREPARE add_archive_cancelled_turn_ids_stmt;

-- This selection table belonged to the removed assistant tool-selection state
-- machine. The registry-owned tool contract is now the only authority.
DROP TABLE IF EXISTS `project_assistant_tool_selections`;
