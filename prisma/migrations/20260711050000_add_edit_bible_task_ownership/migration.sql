ALTER TABLE `project_edit_bibles`
  ADD COLUMN `generationTaskId` VARCHAR(191) NULL,
  ADD INDEX `project_edit_bibles_generationTaskId_idx` (`generationTaskId`);
