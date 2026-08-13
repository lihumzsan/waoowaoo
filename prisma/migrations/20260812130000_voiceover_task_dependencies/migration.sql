CREATE TABLE `task_dependencies` (
  `id` VARCHAR(191) NOT NULL,
  `operationExecutionId` VARCHAR(191) NOT NULL,
  `targetTaskId` VARCHAR(191) NOT NULL,
  `sourceTaskId` VARCHAR(191) NOT NULL,
  `requirement` VARCHAR(32) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `task_dependencies_targetTaskId_sourceTaskId_key` (`targetTaskId`, `sourceTaskId`),
  INDEX `task_dependencies_operationExecutionId_targetTaskId_idx` (`operationExecutionId`, `targetTaskId`),
  INDEX `task_dependencies_sourceTaskId_idx` (`sourceTaskId`),
  CONSTRAINT `task_dependencies_requirement_check` CHECK (`requirement` = 'required_success'),
  CONSTRAINT `task_dependencies_source_target_distinct_check` CHECK (`targetTaskId` <> `sourceTaskId`),
  CONSTRAINT `task_dependencies_operationExecutionId_fkey` FOREIGN KEY (`operationExecutionId`) REFERENCES `operation_executions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `task_dependencies_targetTaskId_fkey` FOREIGN KEY (`targetTaskId`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `task_dependencies_sourceTaskId_fkey` FOREIGN KEY (`sourceTaskId`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
