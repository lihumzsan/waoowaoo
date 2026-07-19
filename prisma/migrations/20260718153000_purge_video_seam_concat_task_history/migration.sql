-- Seam-concat runs are transient UI operations and must not remain in task history.
-- TaskEvent rows are removed by the Task foreign key's ON DELETE CASCADE rule.
DELETE FROM `tasks`
WHERE `projectId` = 'video-tools'
  AND `type` = 'video_seam_concat';
