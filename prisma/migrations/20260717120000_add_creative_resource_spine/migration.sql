CREATE TABLE `creative_resources` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NULL,
  `episodeId` VARCHAR(191) NULL,
  `scopeKind` VARCHAR(32) NOT NULL,
  `scopeId` VARCHAR(191) NOT NULL,
  `mediaType` VARCHAR(16) NOT NULL,
  `schemaId` VARCHAR(96) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `originKey` VARCHAR(191) NOT NULL,
  `sourceType` VARCHAR(96) NULL,
  `sourceId` VARCHAR(191) NULL,
  `candidateSetId` VARCHAR(191) NULL,
  `candidateIndex` INTEGER NULL,
  `headRevisionId` VARCHAR(191) NULL,
  `errorCode` VARCHAR(128) NULL,
  `errorMessage` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `creative_resources_origin_key`(`originKey`),
  UNIQUE INDEX `creative_resources_source_key`(`sourceType`, `sourceId`),
  UNIQUE INDEX `creative_resources_head_revision_key`(`headRevisionId`),
  INDEX `creative_resources_scope_created_idx`(`userId`, `scopeKind`, `scopeId`, `createdAt`),
  INDEX `creative_resources_project_episode_idx`(`projectId`, `episodeId`, `createdAt`),
  INDEX `creative_resources_schema_media_idx`(`schemaId`, `mediaType`, `createdAt`),
  INDEX `creative_resources_candidate_idx`(`candidateSetId`, `candidateIndex`),
  PRIMARY KEY (`id`),
  CONSTRAINT `creative_resources_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resources_projectId_fkey`
    FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resources_episodeId_fkey`
    FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `creative_resource_revisions` (
  `id` VARCHAR(191) NOT NULL,
  `resourceId` VARCHAR(191) NOT NULL,
  `revision` INTEGER NOT NULL,
  `fingerprint` VARCHAR(64) NOT NULL,
  `contentText` LONGTEXT NULL,
  `contentJson` JSON NULL,
  `mediaId` VARCHAR(191) NULL,
  `sourceType` VARCHAR(96) NULL,
  `sourceId` VARCHAR(191) NULL,
  `sourceRevision` VARCHAR(96) NULL,
  `prompt` LONGTEXT NULL,
  `modelKey` VARCHAR(191) NULL,
  `generationOptions` JSON NULL,
  `operationId` VARCHAR(128) NULL,
  `inputHash` VARCHAR(64) NULL,
  `taskId` VARCHAR(191) NULL,
  `operationExecutionId` VARCHAR(191) NULL,
  `executionSegmentId` VARCHAR(191) NULL,
  `toolCallId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `creative_revisions_resource_revision_key`(`resourceId`, `revision`),
  UNIQUE INDEX `creative_revisions_task_resource_key`(`taskId`, `resourceId`),
  UNIQUE INDEX `creative_revisions_source_key`(`sourceType`, `sourceId`, `sourceRevision`),
  INDEX `creative_revisions_fingerprint_idx`(`fingerprint`),
  INDEX `creative_revisions_media_idx`(`mediaId`),
  INDEX `creative_revisions_task_idx`(`taskId`),
  INDEX `creative_revisions_execution_idx`(`operationExecutionId`),
  INDEX `creative_revisions_operation_input_idx`(`operationId`, `inputHash`),
  PRIMARY KEY (`id`),
  CONSTRAINT `creative_resource_revisions_resourceId_fkey`
    FOREIGN KEY (`resourceId`) REFERENCES `creative_resources`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_revisions_mediaId_fkey`
    FOREIGN KEY (`mediaId`) REFERENCES `media_objects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_revisions_taskId_fkey`
    FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_revisions_operationExecutionId_fkey`
    FOREIGN KEY (`operationExecutionId`) REFERENCES `operation_executions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `creative_resource_lineage` (
  `id` VARCHAR(191) NOT NULL,
  `outputRevisionId` VARCHAR(191) NOT NULL,
  `inputRevisionId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(64) NOT NULL,
  `position` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `creative_lineage_output_role_position_key`(`outputRevisionId`, `role`, `position`),
  INDEX `creative_lineage_input_idx`(`inputRevisionId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `creative_resource_lineage_outputRevisionId_fkey`
    FOREIGN KEY (`outputRevisionId`) REFERENCES `creative_resource_revisions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_lineage_inputRevisionId_fkey`
    FOREIGN KEY (`inputRevisionId`) REFERENCES `creative_resource_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `creative_resource_bindings` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NULL,
  `episodeId` VARCHAR(191) NULL,
  `scopeKind` VARCHAR(32) NOT NULL,
  `scopeId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(64) NOT NULL,
  `slotKey` VARCHAR(128) NOT NULL,
  `resourceId` VARCHAR(191) NOT NULL,
  `revisionId` VARCHAR(191) NOT NULL,
  `source` VARCHAR(64) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `creative_bindings_scope_role_slot_key`(`scopeKind`, `scopeId`, `role`, `slotKey`),
  INDEX `creative_bindings_user_scope_idx`(`userId`, `scopeKind`, `scopeId`),
  INDEX `creative_bindings_project_episode_idx`(`projectId`, `episodeId`),
  INDEX `creative_bindings_resource_idx`(`resourceId`),
  INDEX `creative_bindings_revision_idx`(`revisionId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `creative_resource_bindings_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_bindings_projectId_fkey`
    FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_bindings_episodeId_fkey`
    FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_bindings_resourceId_fkey`
    FOREIGN KEY (`resourceId`) REFERENCES `creative_resources`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_bindings_revisionId_fkey`
    FOREIGN KEY (`revisionId`) REFERENCES `creative_resource_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `creative_resources`
  ADD CONSTRAINT `creative_resources_headRevisionId_fkey`
  FOREIGN KEY (`headRevisionId`) REFERENCES `creative_resource_revisions`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
