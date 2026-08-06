-- Public-beta reservations are an explicit consented contact fact, separate
-- from authentication identities and paid-beta seat/payment lifecycles.

CREATE TABLE `public_beta_waitlist_entries` (
  `id` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(64) NOT NULL,
  `phoneE164` VARCHAR(32) NOT NULL,
  `locale` VARCHAR(8) NOT NULL,
  `source` VARCHAR(32) NOT NULL,
  `consentedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `public_beta_waitlist_entries_campaignId_phoneE164_key` (`campaignId`, `phoneE164`),
  INDEX `public_beta_waitlist_entries_campaignId_createdAt_idx` (`campaignId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
