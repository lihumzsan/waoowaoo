CREATE TABLE `project_agent_continuation_checkpoints` (
  `commandId` VARCHAR(191) NOT NULL,
  `waitId` VARCHAR(191) NOT NULL,
  `runId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'running',
  `outcome` VARCHAR(32) NULL,
  `messageId` VARCHAR(191) NULL,
  `messageJson` JSON NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  UNIQUE INDEX `project_agent_continuation_checkpoints_waitId_key`(`waitId`),
  INDEX `project_agent_continuation_checkpoints_runId_startedAt_idx`(`runId`, `startedAt`),
  PRIMARY KEY (`commandId`),
  CONSTRAINT `project_agent_continuation_checkpoints_waitId_fkey`
    FOREIGN KEY (`waitId`) REFERENCES `project_agent_waits`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
