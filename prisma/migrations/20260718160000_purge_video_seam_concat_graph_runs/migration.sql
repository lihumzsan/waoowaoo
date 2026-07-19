-- Seam-concat is no longer a persisted workflow. Remove its legacy run history;
-- graph steps, attempts, events, checkpoints, and artifacts cascade from GraphRun.
DELETE FROM `graph_runs`
WHERE `projectId` = 'video-tools'
  AND (
    `taskType` = 'video_seam_concat'
    OR `workflowType` = 'video_seam_concat'
  );
