CREATE TABLE `project_agent_execution_handoffs` (
  `id` VARCHAR(191) NOT NULL,
  `executionSegmentId` VARCHAR(191) NOT NULL,
  `runId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `assistantId` VARCHAR(64) NOT NULL,
  `scopeRef` VARCHAR(64) NOT NULL,
  `episodeId` VARCHAR(191) NULL,
  `locale` VARCHAR(16) NOT NULL DEFAULT 'en',
  `kind` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'prepared',
  `operationId` VARCHAR(128) NOT NULL,
  `payload` JSON NOT NULL,
  `settledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `project_agent_execution_handoffs_executionSegmentId_key`(`executionSegmentId`),
  INDEX `project_agent_execution_handoffs_runId_status_idx`(`runId`, `status`),
  INDEX `project_agent_execution_handoffs_projectId_userId_assistantId_scopeRef_status_createdAt_idx`(`projectId`, `userId`, `assistantId`, `scopeRef`, `status`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `project_agent_execution_handoffs_runId_fkey`
    FOREIGN KEY (`runId`) REFERENCES `project_agent_runs`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
