CREATE TABLE `invite_codes` (
  `id` VARCHAR(191) NOT NULL,
  `codeHash` VARCHAR(128) NOT NULL,
  `amount` DECIMAL(18, 6) NOT NULL,
  `maxRedemptions` INTEGER NULL,
  `redeemedCount` INTEGER NOT NULL DEFAULT 0,
  `expiresAt` DATETIME(3) NULL,
  `disabledAt` DATETIME(3) NULL,
  `description` TEXT NULL,
  `createdBy` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `invite_codes_codeHash_key`(`codeHash`),
  INDEX `invite_codes_expiresAt_idx`(`expiresAt`),
  INDEX `invite_codes_disabledAt_idx`(`disabledAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `invite_redemptions` (
  `id` VARCHAR(191) NOT NULL,
  `inviteCodeId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(18, 6) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `invite_redemptions_inviteCodeId_userId_key`(`inviteCodeId`, `userId`),
  INDEX `invite_redemptions_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `invite_redemptions`
  ADD CONSTRAINT `invite_redemptions_inviteCodeId_fkey`
  FOREIGN KEY (`inviteCodeId`) REFERENCES `invite_codes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `invite_redemptions`
  ADD CONSTRAINT `invite_redemptions_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
