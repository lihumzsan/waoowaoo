-- Clear is claimed on the active Thread before Runtime stop so concurrent
-- admission fails closed and archived request replay cannot stop a newer Turn.
SET @add_thread_clear_request_id_sql = IF(
  (
    SELECT COUNT(*)
    FROM `information_schema`.`columns`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'project_assistant_threads'
      AND `column_name` = 'clearRequestId'
  ) = 1,
  'SELECT 1',
  'ALTER TABLE `project_assistant_threads` ADD COLUMN `clearRequestId` VARCHAR(128) NULL'
);
PREPARE add_thread_clear_request_id_stmt
  FROM @add_thread_clear_request_id_sql;
EXECUTE add_thread_clear_request_id_stmt;
DEALLOCATE PREPARE add_thread_clear_request_id_stmt;
