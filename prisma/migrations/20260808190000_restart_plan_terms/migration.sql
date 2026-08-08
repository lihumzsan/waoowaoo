-- Every successful plan payment starts a new paid term. Existing terms receive
-- a stable synthetic identity; new terms use the canonical payment identity.
-- Grant idempotency includes that term identity so period zero can safely be
-- granted again when a user buys or upgrades today.

ALTER TABLE `subscriptions`
  ADD COLUMN `currentTermKey` VARCHAR(128) NULL;

UPDATE `subscriptions`
SET `currentTermKey` = UUID()
WHERE `currentTermKey` IS NULL;

ALTER TABLE `subscription_grants`
  ADD COLUMN `termKey` VARCHAR(128) NULL;

UPDATE `subscription_grants` AS grant_row
INNER JOIN `subscriptions` AS subscription
  ON subscription.`id` = grant_row.`subscriptionId`
SET grant_row.`termKey` = subscription.`currentTermKey`
WHERE grant_row.`termKey` IS NULL;

ALTER TABLE `subscription_grants`
  DROP INDEX `subscription_grants_subscriptionId_periodIndex_key`,
  ADD UNIQUE INDEX `subscription_grants_subscriptionId_termKey_periodIndex_key`
    (`subscriptionId`, `termKey`, `periodIndex`);

ALTER TABLE `subscriptions`
  MODIFY `currentTermKey` VARCHAR(128) NOT NULL;

ALTER TABLE `subscription_grants`
  MODIFY `termKey` VARCHAR(128) NOT NULL;
