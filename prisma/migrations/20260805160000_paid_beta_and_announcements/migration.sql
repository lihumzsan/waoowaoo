-- First paid-beta wave and versioned in-app announcement acknowledgements.
--
-- This migration creates control-plane facts only. It does not backfill old
-- payments into the wave. Provider objects without the new attempt identity
-- are accepted only during the explicit 24-hour deployment handoff window;
-- every object after that finite cutoff must carry a PaidBetaPaymentAttempt.

CREATE TABLE `paid_beta_campaigns` (
  `id` VARCHAR(64) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `capacity` INT NOT NULL,
  `startsAt` DATETIME(3) NOT NULL,
  `endsAt` DATETIME(3) NULL,
  `legacyPaymentCutoffAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `paid_beta_campaigns_status_startsAt_endsAt_idx` (`status`, `startsAt`, `endsAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `paid_beta_seats` (
  `id` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(64) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `paidAt` DATETIME(3) NULL,
  `releasedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `paid_beta_seats_campaignId_userId_key` (`campaignId`, `userId`),
  INDEX `paid_beta_seats_campaignId_status_createdAt_idx` (`campaignId`, `status`, `createdAt`),
  INDEX `paid_beta_seats_userId_status_idx` (`userId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `paid_beta_payment_attempts` (
  `id` VARCHAR(191) NOT NULL,
  `seatId` VARCHAR(191) NOT NULL,
  `providerKind` VARCHAR(32) NOT NULL,
  `providerObjectId` VARCHAR(191) NULL,
  `status` VARCHAR(16) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `paidAt` DATETIME(3) NULL,
  `terminalAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `paid_beta_payment_attempts_providerObjectId_key` (`providerObjectId`),
  INDEX `paid_beta_payment_attempts_seatId_status_expiresAt_idx` (`seatId`, `status`, `expiresAt`),
  INDEX `paid_beta_payment_attempts_status_expiresAt_idx` (`status`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `announcement_receipts` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `announcementId` VARCHAR(96) NOT NULL,
  `version` INT NOT NULL,
  `acknowledgedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `announcement_receipts_userId_announcementId_version_key` (`userId`, `announcementId`, `version`),
  INDEX `announcement_receipts_userId_acknowledgedAt_idx` (`userId`, `acknowledgedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `paid_beta_seats`
  ADD CONSTRAINT `paid_beta_seats_campaignId_fkey`
  FOREIGN KEY (`campaignId`) REFERENCES `paid_beta_campaigns` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `paid_beta_seats`
  ADD CONSTRAINT `paid_beta_seats_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `paid_beta_payment_attempts`
  ADD CONSTRAINT `paid_beta_payment_attempts_seatId_fkey`
  FOREIGN KEY (`seatId`) REFERENCES `paid_beta_seats` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `announcement_receipts`
  ADD CONSTRAINT `announcement_receipts_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `paid_beta_campaigns` (
  `id`, `status`, `capacity`, `startsAt`, `legacyPaymentCutoffAt`, `createdAt`, `updatedAt`
) VALUES (
  'paid-beta-wave-1',
  'active',
  100,
  CURRENT_TIMESTAMP(3),
  DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR),
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
);
