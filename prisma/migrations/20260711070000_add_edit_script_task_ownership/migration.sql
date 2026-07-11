ALTER TABLE `project_edit_scripts`
  ADD COLUMN `generationTaskId` VARCHAR(191) NULL;

CREATE INDEX `project_edit_scripts_generationTaskId_idx`
  ON `project_edit_scripts`(`generationTaskId`);

ALTER TABLE `project_edit_shot_execution_plans`
  ADD COLUMN `generationTaskId` VARCHAR(191) NULL;

CREATE INDEX `project_edit_shot_execution_plans_generationTaskId_idx`
  ON `project_edit_shot_execution_plans`(`generationTaskId`);
