CREATE TABLE `assistant_tool_approvals` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NULL,
  `assistantId` VARCHAR(64) NOT NULL,
  `scopeRef` VARCHAR(64) NOT NULL,
  `toolCallId` VARCHAR(191) NOT NULL,
  `operationId` VARCHAR(128) NOT NULL,
  `operationInputJson` JSON NOT NULL,
  `operationInputHash` VARCHAR(64) NOT NULL,
  `contextJson` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `resultJson` JSON NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `resolvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `assistant_tool_approvals_projectId_userId_assistantId_scopeRef_status_createdAt_idx`
  ON `assistant_tool_approvals`(`projectId`, `userId`, `assistantId`, `scopeRef`, `status`, `createdAt`);
CREATE INDEX `assistant_tool_approvals_projectId_status_createdAt_idx`
  ON `assistant_tool_approvals`(`projectId`, `status`, `createdAt`);
CREATE INDEX `assistant_tool_approvals_toolCallId_idx`
  ON `assistant_tool_approvals`(`toolCallId`);
CREATE INDEX `assistant_tool_approvals_operationId_idx`
  ON `assistant_tool_approvals`(`operationId`);

ALTER TABLE `assistant_tool_approvals`
  ADD CONSTRAINT `assistant_tool_approvals_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `assistant_tool_approvals`
  ADD CONSTRAINT `assistant_tool_approvals_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
