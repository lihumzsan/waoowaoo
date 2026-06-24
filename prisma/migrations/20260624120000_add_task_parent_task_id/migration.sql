ALTER TABLE `tasks`
  ADD COLUMN `parentTaskId` VARCHAR(191) NULL;

CREATE INDEX `tasks_parentTaskId_idx` ON `tasks`(`parentTaskId`);

ALTER TABLE `tasks`
  ADD CONSTRAINT `tasks_parentTaskId_fkey`
  FOREIGN KEY (`parentTaskId`) REFERENCES `tasks`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
