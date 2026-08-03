CREATE TABLE `project_assistant_message_commands` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `assistantId` VARCHAR(64) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `threadId` VARCHAR(191) NOT NULL,
    `turnId` VARCHAR(191) NOT NULL,
    `runtimeTurnId` VARCHAR(191) NULL,
    `messageJson` JSON NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_assistant_message_commands_scope_source_key`(`projectId`, `userId`, `assistantId`, `sourceId`),
    INDEX `project_assistant_message_commands_threadId_createdAt_idx`(`threadId`, `createdAt`),
    INDEX `project_assistant_message_commands_turnId_status_createdAt_idx`(`turnId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_assistant_message_commands`
    ADD CONSTRAINT `project_assistant_message_commands_projectId_fkey`
    FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_assistant_message_commands`
    ADD CONSTRAINT `project_assistant_message_commands_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
