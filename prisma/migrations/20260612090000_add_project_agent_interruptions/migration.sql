-- AlterTable
ALTER TABLE `project_agent_waits` ADD COLUMN `followUpMode` VARCHAR(32) NOT NULL DEFAULT 'resume_agent';

-- CreateTable
CREATE TABLE `project_agent_interruptions` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `assistantId` VARCHAR(64) NOT NULL,
    `scopeRef` VARCHAR(64) NOT NULL,
    `episodeId` VARCHAR(191) NULL,
    `type` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `operationId` VARCHAR(128) NOT NULL,
    `approvalId` VARCHAR(128) NOT NULL,
    `toolCallId` VARCHAR(128) NULL,
    `payload` JSON NOT NULL,
    `runState` LONGTEXT NULL,
    `response` JSON NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `project_agent_interruptions_projectId_userId_assistantId_sco_idx`(`projectId`, `userId`, `assistantId`, `scopeRef`, `status`, `createdAt`),
    INDEX `project_agent_interruptions_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `project_agent_interruptions` ADD CONSTRAINT `project_agent_interruptions_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_agent_interruptions` ADD CONSTRAINT `project_agent_interruptions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

