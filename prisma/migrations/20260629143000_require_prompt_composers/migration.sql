DELETE FROM `project_video_groups`;

UPDATE `project_panels`
SET
  `imagePrompt` = NULL,
  `videoPrompt` = NULL
WHERE `renderFactsJson` IS NOT NULL;
