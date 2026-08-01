ALTER TABLE `project_canvas_node_layouts`
  ADD COLUMN `hidden` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `operation_plan_snapshots`
  ADD COLUMN `apiRequestId` VARCHAR(128) NULL,
  ADD COLUMN `apiRequestContextHash` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `operation_plan_snapshots_api_request_key`
  ON `operation_plan_snapshots`(`userId`, `scopeKind`, `scopeId`, `operationId`, `apiRequestId`);

ALTER TABLE `creative_resources`
  ADD COLUMN `alternativeGroupExecutionId` VARCHAR(191) NULL,
  ADD COLUMN `archivedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `creative_resources_alternative_member_key`
  ON `creative_resources`(`alternativeGroupExecutionId`, `memberIndex`);

CREATE INDEX `creative_resources_alternative_group_idx`
  ON `creative_resources`(`alternativeGroupExecutionId`);

CREATE INDEX `creative_resources_project_archive_idx`
  ON `creative_resources`(`projectId`, `episodeId`, `archivedAt`, `createdAt`);

ALTER TABLE `creative_resources`
  ADD CONSTRAINT `creative_resources_alternative_group_execution_fkey`
    FOREIGN KEY (`alternativeGroupExecutionId`) REFERENCES `operation_executions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
