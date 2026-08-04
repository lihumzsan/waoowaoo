-- CreateTable
CREATE TABLE `project_agent_activities` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `assistantId` VARCHAR(64) NOT NULL,
    `scopeRef` VARCHAR(64) NOT NULL,
    `episodeId` VARCHAR(191) NULL,
    `type` VARCHAR(48) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'running',
    `operationId` VARCHAR(128) NULL,
    `sourceOperationId` VARCHAR(128) NULL,
    `toolCallId` VARCHAR(128) NULL,
    `choiceType` VARCHAR(64) NULL,
    `errorCode` VARCHAR(128) NULL,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `project_agent_activities_runId_status_createdAt_idx`(`runId`, `status`, `createdAt`),
    INDEX `project_agent_activities_projectId_userId_assistantId_scopeRef_status_createdAt_idx`(`projectId`, `userId`, `assistantId`, `scopeRef`, `status`, `createdAt`),
    INDEX `project_agent_activities_projectId_status_createdAt_idx`(`projectId`, `status`, `createdAt`),
    INDEX `project_agent_activities_operationId_idx`(`operationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_agent_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `assistantId` VARCHAR(64) NOT NULL,
    `scopeRef` VARCHAR(64) NOT NULL,
    `episodeId` VARCHAR(191) NULL,
    `runId` VARCHAR(191) NULL,
    `activityId` VARCHAR(191) NULL,
    `kind` VARCHAR(64) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_agent_events_idempotencyKey_key`(`idempotencyKey`),
    INDEX `project_agent_events_projectId_userId_assistantId_scopeRef_id_idx`(`projectId`, `userId`, `assistantId`, `scopeRef`, `id`),
    INDEX `project_agent_events_runId_id_idx`(`runId`, `id`),
    INDEX `project_agent_events_activityId_id_idx`(`activityId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `project_agent_waits` ADD COLUMN `activityId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `project_agent_interruptions` ADD COLUMN `activityId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `project_agent_waits_activityId_idx` ON `project_agent_waits`(`activityId`);

-- CreateIndex
CREATE INDEX `project_agent_interruptions_activityId_idx` ON `project_agent_interruptions`(`activityId`);

-- AddForeignKey
ALTER TABLE `project_agent_activities` ADD CONSTRAINT `project_agent_activities_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `project_agent_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_agent_activities` ADD CONSTRAINT `project_agent_activities_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_agent_activities` ADD CONSTRAINT `project_agent_activities_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_agent_events` ADD CONSTRAINT `project_agent_events_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_agent_events` ADD CONSTRAINT `project_agent_events_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_agent_waits` ADD CONSTRAINT `project_agent_waits_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `project_agent_activities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_agent_interruptions` ADD CONSTRAINT `project_agent_interruptions_activityId_fkey` FOREIGN KEY (`activityId`) REFERENCES `project_agent_activities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
