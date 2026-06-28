ALTER TABLE `project_agent_waits`
  ADD COLUMN `followUpAttemptCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `followUpLastErrorCode` VARCHAR(128) NULL,
  ADD COLUMN `followUpLastErrorMessage` TEXT NULL,
  ADD COLUMN `followUpFailedAt` DATETIME(3) NULL;
