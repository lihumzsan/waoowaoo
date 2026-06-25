ALTER TABLE `project_shots`
  DROP FOREIGN KEY `project_shots_clipId_fkey`;

ALTER TABLE `project_storyboards`
  DROP FOREIGN KEY `project_storyboards_clipId_fkey`;

DROP INDEX `project_shots_clipId_idx` ON `project_shots`;

DROP INDEX `project_storyboards_clipId_idx` ON `project_storyboards`;

DROP INDEX `project_storyboards_clipId_key` ON `project_storyboards`;

ALTER TABLE `project_shots`
  DROP COLUMN `clipId`;

ALTER TABLE `project_storyboards`
  DROP COLUMN `clipId`;

DROP TABLE `project_clips`;
