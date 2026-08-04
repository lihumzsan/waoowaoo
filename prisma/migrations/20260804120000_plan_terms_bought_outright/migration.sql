-- Plans are bought outright instead of subscribed to.
--
-- WeChat Pay cannot back an automatically renewing charge on Stripe, and it is
-- the payment method most of these users have. A plan is therefore a term the
-- user pays for once; buying again extends the term. The Stripe subscription
-- and customer identifiers, and the cancel-at-period-end flag, describe a
-- recurring charge that no longer exists.
--
-- The credit machinery is unchanged: grants are still counted per month from
-- `currentPeriodStart` and still expire, so a yearly term still releases its
-- credits month by month.

ALTER TABLE `subscriptions` DROP INDEX `subscriptions_stripeSubscriptionId_key`;
ALTER TABLE `subscriptions` DROP INDEX `subscriptions_stripeCustomerId_idx`;

ALTER TABLE `subscriptions`
  DROP COLUMN `stripeSubscriptionId`,
  DROP COLUMN `stripeCustomerId`,
  DROP COLUMN `cancelAtPeriodEnd`;
