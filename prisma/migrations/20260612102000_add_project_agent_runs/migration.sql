CREATE TABLE `project_agent_runs` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `assistantId` VARCHAR(64) NOT NULL,
    `scopeRef` VARCHAR(64) NOT NULL,
    `episodeId` VARCHAR(191) NULL,
    `requestId` VARCHAR(96) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'running',
    `controlKind` VARCHAR(32) NOT NULL,
    `stopReason` VARCHAR(64) NULL,
    `errorCode` VARCHAR(128) NULL,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `project_agent_runs_projectId_userId_assistantId_scopeRef_s_idx`(`projectId`, `userId`, `assistantId`, `scopeRef`, `status`, `createdAt`),
    INDEX `project_agent_runs_projectId_status_createdAt_idx`(`projectId`, `status`, `createdAt`),
    INDEX `project_agent_runs_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_agent_waits` ADD COLUMN `runId` VARCHAR(191) NULL;
ALTER TABLE `project_agent_interruptions` ADD COLUMN `runId` VARCHAR(191) NULL;

CREATE INDEX `project_agent_waits_runId_idx` ON `project_agent_waits`(`runId`);
CREATE INDEX `project_agent_interruptions_runId_status_createdAt_idx` ON `project_agent_interruptions`(`runId`, `status`, `createdAt`);

ALTER TABLE `project_agent_runs` ADD CONSTRAINT `project_agent_runs_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_agent_runs` ADD CONSTRAINT `project_agent_runs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_agent_waits` ADD CONSTRAINT `project_agent_waits_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `project_agent_runs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_agent_interruptions` ADD CONSTRAINT `project_agent_interruptions_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `project_agent_runs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
