CREATE INDEX `tasks_project_target_type_status_updated_idx`
  ON `tasks` (`projectId`, `targetType`, `targetId`, `type`, `status`, `updatedAt`);

CREATE INDEX `tasks_project_video_history_idx`
  ON `tasks` (`projectId`, `type`, `status`, `targetType`, `targetId`, `finishedAt`);
