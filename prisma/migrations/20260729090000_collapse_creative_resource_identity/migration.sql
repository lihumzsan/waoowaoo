-- One-time protocol cutover: one short CreativeResource ID now identifies one
-- immutable materialization. Old Resource/Revision rows cannot be translated
-- without guessing which identity downstream callers intended, so fail closed.
DROP TABLE IF EXISTS `_creative_resource_cutover_guard`;
CREATE TABLE `_creative_resource_cutover_guard` (
  `id` INTEGER NOT NULL,
  PRIMARY KEY (`id`)
);
INSERT INTO `_creative_resource_cutover_guard` (`id`) VALUES (1), (2), (3);

-- Each statement deliberately collides with one guard key when the old
-- identity protocol still owns data. The migration must stop instead of
-- inventing a Resource mapping.
INSERT INTO `_creative_resource_cutover_guard` (`id`)
  SELECT 1 FROM `creative_resources` LIMIT 1;
INSERT INTO `_creative_resource_cutover_guard` (`id`)
  SELECT 2 FROM `project_episode_source_documents` LIMIT 1;
INSERT INTO `_creative_resource_cutover_guard` (`id`)
  SELECT 3 FROM `project_story_canons` LIMIT 1;

DROP TABLE `_creative_resource_cutover_guard`;

-- Domain projections retain one exact Resource identity.
ALTER TABLE `project_episode_source_documents`
  DROP INDEX `project_episode_source_documents_episodeId_sourceRevisionId_key`,
  DROP INDEX `project_episode_source_documents_sourceResourceId_idx`,
  DROP COLUMN `sourceResourceId`,
  CHANGE COLUMN `sourceRevisionId` `sourceResourceId` VARCHAR(32) NOT NULL;

CREATE UNIQUE INDEX `project_episode_source_documents_episodeId_sourceResourceId_key`
  ON `project_episode_source_documents`(`episodeId`, `sourceResourceId`);
CREATE INDEX `project_episode_source_documents_sourceResourceId_idx`
  ON `project_episode_source_documents`(`sourceResourceId`);

ALTER TABLE `project_story_canons`
  DROP INDEX `project_story_canons_storyCanonResourceId_idx`,
  DROP INDEX `project_story_canons_storyCanonRevisionId_idx`,
  DROP COLUMN `storyCanonResourceId`,
  CHANGE COLUMN `storyCanonRevisionId` `storyCanonResourceId` VARCHAR(32) NOT NULL;

CREATE INDEX `project_story_canons_storyCanonResourceId_idx`
  ON `project_story_canons`(`storyCanonResourceId`);

-- All old relation tables are empty by the preflight above. Recreate them with
-- Resource-to-Resource identities instead of preserving a second protocol.
ALTER TABLE `creative_resources`
  DROP FOREIGN KEY `creative_resources_headRevisionId_fkey`;

DROP TABLE `creative_resource_lineage`;
DROP TABLE `creative_resource_bindings`;
DROP TABLE `creative_resource_revisions`;

ALTER TABLE `creative_resources`
  DROP INDEX `creative_resources_origin_key`,
  DROP INDEX `creative_resources_head_revision_key`,
  DROP COLUMN `originKey`,
  DROP COLUMN `headRevisionId`,
  MODIFY COLUMN `id` VARCHAR(32) NOT NULL,
  MODIFY COLUMN `candidateSetId` VARCHAR(32) NULL,
  ADD COLUMN `contentText` LONGTEXT NULL AFTER `candidateIndex`,
  ADD COLUMN `contentJson` JSON NULL AFTER `contentText`,
  ADD COLUMN `mediaId` VARCHAR(191) NULL AFTER `contentJson`,
  ADD COLUMN `prompt` LONGTEXT NULL AFTER `mediaId`,
  ADD COLUMN `modelKey` VARCHAR(191) NULL AFTER `prompt`,
  ADD COLUMN `generationOptions` JSON NULL AFTER `modelKey`,
  ADD COLUMN `operationId` VARCHAR(128) NULL AFTER `generationOptions`,
  ADD COLUMN `inputHash` VARCHAR(64) NULL AFTER `operationId`,
  ADD COLUMN `taskId` VARCHAR(191) NULL AFTER `inputHash`,
  ADD COLUMN `operationExecutionId` VARCHAR(191) NULL AFTER `taskId`,
  ADD COLUMN `executionSegmentId` VARCHAR(191) NULL AFTER `operationExecutionId`,
  ADD COLUMN `toolCallId` VARCHAR(191) NULL AFTER `executionSegmentId`,
  ADD COLUMN `materializedAt` DATETIME(3) NULL AFTER `creativeDataVersion`;

CREATE INDEX `creative_resources_media_idx`
  ON `creative_resources`(`mediaId`);
CREATE INDEX `creative_resources_task_idx`
  ON `creative_resources`(`taskId`);
CREATE INDEX `creative_resources_execution_idx`
  ON `creative_resources`(`operationExecutionId`);
CREATE INDEX `creative_resources_operation_input_idx`
  ON `creative_resources`(`operationId`, `inputHash`);

ALTER TABLE `creative_resources`
  ADD CONSTRAINT `creative_resources_mediaId_fkey`
    FOREIGN KEY (`mediaId`) REFERENCES `media_objects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `creative_resources_taskId_fkey`
    FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `creative_resources_operationExecutionId_fkey`
    FOREIGN KEY (`operationExecutionId`) REFERENCES `operation_executions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `creative_resource_lineage` (
  `id` VARCHAR(191) NOT NULL,
  `outputResourceId` VARCHAR(32) NOT NULL,
  `inputResourceId` VARCHAR(32) NOT NULL,
  `role` VARCHAR(64) NOT NULL,
  `position` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `creative_lineage_output_role_position_key`(`outputResourceId`, `role`, `position`),
  INDEX `creative_lineage_input_idx`(`inputResourceId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `creative_resource_lineage_outputResourceId_fkey`
    FOREIGN KEY (`outputResourceId`) REFERENCES `creative_resources`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_lineage_inputResourceId_fkey`
    FOREIGN KEY (`inputResourceId`) REFERENCES `creative_resources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  `resourceId` VARCHAR(32) NOT NULL,
  `source` VARCHAR(64) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `creative_bindings_scope_role_slot_key`(`scopeKind`, `scopeId`, `role`, `slotKey`),
  INDEX `creative_bindings_user_scope_idx`(`userId`, `scopeKind`, `scopeId`),
  INDEX `creative_bindings_project_episode_idx`(`projectId`, `episodeId`),
  INDEX `creative_bindings_resource_idx`(`resourceId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `creative_resource_bindings_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_bindings_projectId_fkey`
    FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_bindings_episodeId_fkey`
    FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `creative_resource_bindings_resourceId_fkey`
    FOREIGN KEY (`resourceId`) REFERENCES `creative_resources`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
