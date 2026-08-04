ALTER TABLE `project_agent_runs` ADD COLUMN `heartbeatAt` DATETIME(3) NULL;

UPDATE `project_agent_runs` SET `heartbeatAt` = `updatedAt` WHERE `status` = 'running' AND `heartbeatAt` IS NULL;

CREATE INDEX `project_agent_runs_scope_status_heartbeat_idx` ON `project_agent_runs`(`projectId`, `userId`, `assistantId`, `scopeRef`, `status`, `heartbeatAt`);
