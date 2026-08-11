-- Incompatible source-failure cutover: drain active Assistant Turns before
-- applying this migration, then deploy gateway and Assistant settlement code
-- together. No legacy source row exists to backfill.
CREATE TABLE `project_agent_provider_attempts` (
  `sequence` BIGINT NOT NULL AUTO_INCREMENT,
  `id` VARCHAR(191) NOT NULL,
  `turnId` VARCHAR(191) NOT NULL,
  `runtimeAttempt` INTEGER NOT NULL,
  `providerKey` VARCHAR(64) NOT NULL,
  `modelKey` VARCHAR(191) NOT NULL,
  `requestHash` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'started',
  `providerStatus` INTEGER NULL,
  `providerRequestId` VARCHAR(256) NULL,
  `providerGenerationId` VARCHAR(256) NULL,
  `failure` JSON NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,

  UNIQUE INDEX `project_agent_provider_attempts_id_key`(`id`),
  INDEX `project_agent_provider_attempts_turn_attempt_sequence_idx`(`turnId`, `runtimeAttempt`, `sequence`),
  INDEX `project_agent_provider_attempts_status_started_idx`(`status`, `startedAt`),
  PRIMARY KEY (`sequence`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_agent_provider_attempts`
  ADD CONSTRAINT `project_agent_provider_attempts_turnId_fkey`
  FOREIGN KEY (`turnId`) REFERENCES `project_agent_turns`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
