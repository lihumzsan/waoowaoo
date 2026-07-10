ALTER TABLE `task_events`
  ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;

ALTER TABLE `project_agent_waits`
  ADD COLUMN `canceledTaskIds` JSON NULL,
  ADD COLUMN `followUpCommandId` VARCHAR(191) NULL,
  ADD INDEX `project_agent_waits_followUpCommandId_idx`(`followUpCommandId`);

ALTER TABLE `tasks`
  ADD COLUMN `executionFingerprint` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `task_events_idempotencyKey_key`
  ON `task_events`(`idempotencyKey`);

CREATE TABLE `task_execution_checkpoints` (
  `id` VARCHAR(191) NOT NULL,
  `taskId` VARCHAR(191) NOT NULL,
  `stepKey` VARCHAR(128) NOT NULL,
  `inputFingerprint` VARCHAR(64) NOT NULL,
  `state` VARCHAR(32) NOT NULL,
  `output` JSON NOT NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `task_execution_checkpoints_taskId_stepKey_key`(`taskId`, `stepKey`),
  INDEX `task_execution_checkpoints_taskId_state_idx`(`taskId`, `state`),
  PRIMARY KEY (`id`),
  CONSTRAINT `task_execution_checkpoints_taskId_fkey`
    FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `outbox_commands` (
  `id` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(64) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `aggregateType` VARCHAR(64) NOT NULL,
  `aggregateId` VARCHAR(96) NOT NULL,
  `payload` JSON NOT NULL,
  `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `enqueuedAt` DATETIME(3) NULL,
  `acceptedAt` DATETIME(3) NULL,
  `deadAt` DATETIME(3) NULL,
  `deliveryCount` INTEGER NOT NULL DEFAULT 0,
  `leaseOwner` VARCHAR(96) NULL,
  `leaseExpiresAt` DATETIME(3) NULL,
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `outbox_commands_idempotencyKey_key`(`idempotencyKey`),
  INDEX `outbox_commands_acceptedAt_deadAt_availableAt_idx`(`acceptedAt`, `deadAt`, `availableAt`),
  INDEX `outbox_commands_leaseExpiresAt_idx`(`leaseExpiresAt`),
  INDEX `outbox_commands_aggregateType_aggregateId_idx`(`aggregateType`, `aggregateId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
