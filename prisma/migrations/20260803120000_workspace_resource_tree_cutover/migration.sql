-- Clean cutover: old Agent/media execution must be fully drained before any
-- non-transactional MySQL DDL begins. No old Episode/Canvas/Resource data is
-- migrated into the WorkspaceResource tree.
CREATE TEMPORARY TABLE `_workspace_tree_cutover_blockers` (
    `blocker` VARCHAR(128) NOT NULL,
    CONSTRAINT `_workspace_tree_cutover_requires_drain` CHECK (`blocker` = 'OK')
);

INSERT INTO `_workspace_tree_cutover_blockers` (`blocker`)
SELECT 'NON_TERMINAL_TASK'
WHERE EXISTS (
    SELECT 1 FROM `tasks`
    WHERE `status` NOT IN ('completed', 'failed', 'canceled')
)
UNION ALL
SELECT 'NON_TERMINAL_AGENT_TURN'
WHERE EXISTS (
    SELECT 1 FROM `project_agent_turns`
    WHERE `status` IN ('queued', 'running', 'waiting_approval')
)
UNION ALL
SELECT 'PENDING_AGENT_INTERACTION'
WHERE EXISTS (
    SELECT 1 FROM `agent_turn_interactions`
    WHERE `status` IN ('pending', 'approved', 'rejected')
)
UNION ALL
SELECT 'PARTIAL_WORKSPACE_TREE_SCHEMA_PRESENT'
WHERE EXISTS (
    SELECT 1 FROM `information_schema`.`tables`
    WHERE `table_schema` = DATABASE()
      AND `table_name` IN ('workspace_resources', 'workspace_resource_versions', 'workspace_resource_lineage')
);

DROP TEMPORARY TABLE `_workspace_tree_cutover_blockers`;

-- DropForeignKey
ALTER TABLE `character_appearances` DROP FOREIGN KEY `character_appearances_characterId_fkey`;

-- DropForeignKey
ALTER TABLE `character_appearances` DROP FOREIGN KEY `character_appearances_imageMediaId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resource_bindings` DROP FOREIGN KEY `creative_resource_bindings_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resource_bindings` DROP FOREIGN KEY `creative_resource_bindings_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resource_bindings` DROP FOREIGN KEY `creative_resource_bindings_resourceId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resource_bindings` DROP FOREIGN KEY `creative_resource_bindings_userId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resource_lineage` DROP FOREIGN KEY `creative_resource_lineage_inputResourceId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resource_lineage` DROP FOREIGN KEY `creative_resource_lineage_outputResourceId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resources` DROP FOREIGN KEY `creative_resources_alternativeGroupExecutionId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resources` DROP FOREIGN KEY `creative_resources_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resources` DROP FOREIGN KEY `creative_resources_mediaId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resources` DROP FOREIGN KEY `creative_resources_operationExecutionId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resources` DROP FOREIGN KEY `creative_resources_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resources` DROP FOREIGN KEY `creative_resources_taskId_fkey`;

-- DropForeignKey
ALTER TABLE `creative_resources` DROP FOREIGN KEY `creative_resources_userId_fkey`;

-- DropForeignKey
ALTER TABLE `location_images` DROP FOREIGN KEY `location_images_imageMediaId_fkey`;

-- DropForeignKey
ALTER TABLE `location_images` DROP FOREIGN KEY `location_images_locationId_fkey`;

-- DropForeignKey
ALTER TABLE `project_assistant_threads` DROP FOREIGN KEY `project_assistant_threads_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `project_canvas_layouts` DROP FOREIGN KEY `project_canvas_layouts_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_canvas_layouts` DROP FOREIGN KEY `project_canvas_layouts_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `project_characters` DROP FOREIGN KEY `project_characters_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_chapters` DROP FOREIGN KEY `project_edit_chapters_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_chapters` DROP FOREIGN KEY `project_edit_chapters_sourceDocumentId_fkey`;

-- DropForeignKey
ALTER TABLE `project_episode_source_documents` DROP FOREIGN KEY `project_episode_source_documents_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_episodes` DROP FOREIGN KEY `project_episodes_audioMediaId_fkey`;

-- DropForeignKey
ALTER TABLE `project_episodes` DROP FOREIGN KEY `project_episodes_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `project_locations` DROP FOREIGN KEY `project_locations_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `project_locations` DROP FOREIGN KEY `project_locations_selectedImageId_fkey`;

-- DropForeignKey
ALTER TABLE `project_story_canons` DROP FOREIGN KEY `project_story_canons_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_story_canons` DROP FOREIGN KEY `project_story_canons_sourceDocumentId_fkey`;

-- DropIndex
DROP INDEX `project_assistant_threads_projectId_episodeId_updatedAt_idx` ON `project_assistant_threads`;

-- DropIndex
DROP INDEX `project_assistant_threads_projectId_userId_assistantId_scope_key` ON `project_assistant_threads`;

-- AlterTable
ALTER TABLE `approval_grants` DROP COLUMN `episodeId`;

-- AlterTable
ALTER TABLE `balance_transactions` DROP COLUMN `episodeId`;

-- AlterTable
ALTER TABLE `follow_up_batches` DROP COLUMN `episodeId`;

-- AlterTable
ALTER TABLE `operation_executions` DROP COLUMN `episodeId`;

-- AlterTable
ALTER TABLE `operation_plan_snapshots` DROP COLUMN `episodeId`;

-- AlterTable
ALTER TABLE `project_agent_turns` DROP COLUMN `episodeId`;

-- AlterTable
ALTER TABLE `project_assistant_thread_archives` DROP COLUMN `episodeId`,
    DROP COLUMN `scopeRef`;

-- AlterTable
ALTER TABLE `project_assistant_threads` DROP COLUMN `episodeId`,
    DROP COLUMN `scopeRef`;

-- AlterTable
ALTER TABLE `projects` DROP COLUMN `globalAssetText`,
    DROP COLUMN `lastEpisodeId`;

-- AlterTable
ALTER TABLE `tasks` DROP COLUMN `episodeId`;

-- DropTable
DROP TABLE `character_appearances`;

-- DropTable
DROP TABLE `creative_resource_bindings`;

-- DropTable
DROP TABLE `creative_resource_lineage`;

-- DropTable
DROP TABLE `creative_resources`;

-- DropTable
DROP TABLE `location_images`;

-- DropTable
DROP TABLE `project_characters`;

-- DropTable
DROP TABLE `project_edit_chapters`;

-- DropTable
DROP TABLE `project_episode_source_documents`;

-- DropTable
DROP TABLE `project_episodes`;

-- DropTable
DROP TABLE `project_locations`;

-- DropTable
DROP TABLE `project_story_canons`;

-- DropTable
DROP TABLE `project_canvas_node_layouts`;

-- DropTable
DROP TABLE `project_canvas_layouts`;

-- CreateTable
CREATE TABLE `project_canvas_layouts` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `folderKey` VARCHAR(191) NOT NULL,
    `schemaVersion` INTEGER NOT NULL DEFAULT 1,
    `viewportX` DOUBLE NOT NULL DEFAULT 0,
    `viewportY` DOUBLE NOT NULL DEFAULT 0,
    `zoom` DOUBLE NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_canvas_layouts_project_folder_key`(`projectId`, `folderKey`),
    INDEX `project_canvas_layouts_project_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_canvas_node_layouts` (
    `id` VARCHAR(191) NOT NULL,
    `layoutId` VARCHAR(191) NOT NULL,
    `nodeKey` VARCHAR(191) NOT NULL,
    `nodeType` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `x` DOUBLE NOT NULL,
    `y` DOUBLE NOT NULL,
    `width` DOUBLE NOT NULL,
    `height` DOUBLE NOT NULL,
    `zIndex` INTEGER NOT NULL DEFAULT 0,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `collapsed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_canvas_node_layouts_layout_node_key`(`layoutId`, `nodeKey`),
    INDEX `project_canvas_node_layouts_layout_idx`(`layoutId`),
    INDEX `project_canvas_node_layouts_target_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspace_resources` (
    `id` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `workspacePath` VARCHAR(512) NOT NULL,
    `activePath` VARCHAR(512) NULL,
    `resourceKind` VARCHAR(16) NOT NULL DEFAULT 'file',
    `mediaType` VARCHAR(16) NULL,
    `schemaId` VARCHAR(96) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `currentVersion` INTEGER NOT NULL DEFAULT 0,
    `sourceType` VARCHAR(96) NULL,
    `sourceId` VARCHAR(191) NULL,
    `memberIndex` INTEGER NULL,
    `prompt` LONGTEXT NULL,
    `modelKey` VARCHAR(191) NULL,
    `generationOptions` JSON NULL,
    `operationId` VARCHAR(128) NULL,
    `inputHash` VARCHAR(64) NULL,
    `taskId` VARCHAR(191) NULL,
    `operationExecutionId` VARCHAR(191) NULL,
    `alternativeGroupExecutionId` VARCHAR(191) NULL,
    `toolCallId` VARCHAR(191) NULL,
    `errorCode` VARCHAR(128) NULL,
    `errorMessage` TEXT NULL,
    `materializedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `workspace_resources_project_tree_idx`(`projectId`, `deletedAt`, `workspacePath`),
    INDEX `workspace_resources_user_project_idx`(`userId`, `projectId`, `createdAt`),
    INDEX `workspace_resources_kind_schema_media_idx`(`resourceKind`, `schemaId`, `mediaType`, `createdAt`),
    INDEX `workspace_resources_task_idx`(`taskId`),
    INDEX `workspace_resources_execution_idx`(`operationExecutionId`),
    INDEX `workspace_resources_alternative_group_idx`(`alternativeGroupExecutionId`),
    INDEX `workspace_resources_operation_input_idx`(`operationId`, `inputHash`),
    UNIQUE INDEX `workspace_resources_project_active_path_key`(`projectId`, `activePath`),
    UNIQUE INDEX `workspace_resources_source_key`(`sourceType`, `sourceId`),
    UNIQUE INDEX `workspace_resources_alternative_member_key`(`alternativeGroupExecutionId`, `memberIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspace_resource_versions` (
    `id` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(32) NOT NULL,
    `version` INTEGER NOT NULL,
    `contentKind` VARCHAR(16) NOT NULL,
    `mediaId` VARCHAR(191) NOT NULL,
    `sha256` VARCHAR(64) NULL,
    `sizeBytes` BIGINT NULL,
    `sourceTurnId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workspace_resource_versions_media_idx`(`mediaId`),
    UNIQUE INDEX `workspace_resource_versions_resource_version_key`(`resourceId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspace_resource_lineage` (
    `id` VARCHAR(191) NOT NULL,
    `outputResourceId` VARCHAR(32) NOT NULL,
    `outputVersion` INTEGER NOT NULL,
    `inputResourceId` VARCHAR(32) NOT NULL,
    `inputVersion` INTEGER NOT NULL,
    `role` VARCHAR(64) NOT NULL,
    `position` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workspace_lineage_input_idx`(`inputResourceId`),
    UNIQUE INDEX `workspace_lineage_output_version_role_position_key`(`outputResourceId`, `outputVersion`, `role`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `project_assistant_threads_projectId_updatedAt_idx` ON `project_assistant_threads`(`projectId`, `updatedAt`);

-- CreateIndex
CREATE UNIQUE INDEX `project_assistant_threads_projectId_userId_assistantId_key` ON `project_assistant_threads`(`projectId`, `userId`, `assistantId`);

-- AddForeignKey
ALTER TABLE `workspace_resources` ADD CONSTRAINT `workspace_resources_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_assistant_threads` ADD CONSTRAINT `project_assistant_threads_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_resources` ADD CONSTRAINT `workspace_resources_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_resources` ADD CONSTRAINT `workspace_resources_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_resources` ADD CONSTRAINT `workspace_resources_operationExecutionId_fkey` FOREIGN KEY (`operationExecutionId`) REFERENCES `operation_executions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_resources` ADD CONSTRAINT `workspace_resources_alternativeGroupExecutionId_fkey` FOREIGN KEY (`alternativeGroupExecutionId`) REFERENCES `operation_executions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_canvas_layouts` ADD CONSTRAINT `project_canvas_layouts_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_canvas_node_layouts` ADD CONSTRAINT `project_canvas_node_layouts_layoutId_fkey` FOREIGN KEY (`layoutId`) REFERENCES `project_canvas_layouts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_resource_versions` ADD CONSTRAINT `workspace_resource_versions_resourceId_fkey` FOREIGN KEY (`resourceId`) REFERENCES `workspace_resources`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_resource_versions` ADD CONSTRAINT `workspace_resource_versions_mediaId_fkey` FOREIGN KEY (`mediaId`) REFERENCES `media_objects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_resource_lineage` ADD CONSTRAINT `workspace_resource_lineage_outputResourceId_fkey` FOREIGN KEY (`outputResourceId`) REFERENCES `workspace_resources`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_resource_lineage` ADD CONSTRAINT `workspace_resource_lineage_inputResourceId_fkey` FOREIGN KEY (`inputResourceId`) REFERENCES `workspace_resources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
