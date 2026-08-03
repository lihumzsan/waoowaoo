-- Split the balance into two pools and add subscriptions.
--
-- `balance` keeps its meaning: credits that were bought and never expire.
-- `subscriptionCredits` is granted each month by a subscription and expires at
-- `subscriptionExpiresAt`; it is always spent first so a period's grant is not
-- wasted while permanent credits sit unused.
--
-- A freeze now records how much of it came from the subscription pool, so
-- settlement and rollback can return each portion to the pool it came from.

ALTER TABLE `user_balances`
  ADD COLUMN `subscriptionCredits` INT NOT NULL DEFAULT 0,
  ADD COLUMN `subscriptionExpiresAt` DATETIME(3) NULL;

ALTER TABLE `balance_freezes`
  ADD COLUMN `subscriptionAmount` INT NOT NULL DEFAULT 0;

CREATE TABLE `subscriptions` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `planId` VARCHAR(32) NOT NULL,
  `interval` VARCHAR(8) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `stripeSubscriptionId` VARCHAR(191) NOT NULL,
  `stripeCustomerId` VARCHAR(191) NOT NULL,
  `currentPeriodStart` DATETIME(3) NOT NULL,
  `currentPeriodEnd` DATETIME(3) NOT NULL,
  `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `subscriptions_userId_key`(`userId`),
  UNIQUE INDEX `subscriptions_stripeSubscriptionId_key`(`stripeSubscriptionId`),
  INDEX `subscriptions_status_idx`(`status`),
  INDEX `subscriptions_stripeCustomerId_idx`(`stripeCustomerId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `subscription_grants` (
  `id` VARCHAR(191) NOT NULL,
  `subscriptionId` VARCHAR(191) NOT NULL,
  `periodIndex` INT NOT NULL,
  `planId` VARCHAR(32) NOT NULL,
  `credits` INT NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `subscription_grants_subscriptionId_periodIndex_key`(`subscriptionId`, `periodIndex`),
  INDEX `subscription_grants_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `subscriptions`
  ADD CONSTRAINT `subscriptions_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `subscription_grants`
  ADD CONSTRAINT `subscription_grants_subscriptionId_fkey`
  FOREIGN KEY (`subscriptionId`) REFERENCES `subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
