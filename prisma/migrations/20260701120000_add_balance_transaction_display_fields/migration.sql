ALTER TABLE `balance_transactions`
  ADD COLUMN `projectId` VARCHAR(128) NULL,
  ADD COLUMN `episodeId` VARCHAR(128) NULL,
  ADD COLUMN `taskType` VARCHAR(64) NULL,
  ADD COLUMN `billingMeta` TEXT NULL;

CREATE INDEX `balance_transactions_projectId_idx` ON `balance_transactions`(`projectId`);
