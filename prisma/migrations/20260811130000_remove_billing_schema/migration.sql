-- Free-product migration. This file is intentionally unapplied in this change.
-- Apply through the normal deployment migration process after reviewing the
-- retained data policy for the legacy billing tables.

ALTER TABLE `user_preferences`
  DROP COLUMN `assistantBillingConfirmationRequired`;

ALTER TABLE `tasks`
  DROP COLUMN `billingInfo`,
  DROP COLUMN `billedAt`;

ALTER TABLE `operation_plan_snapshots`
  DROP COLUMN `quoteSnapshot`,
  DROP COLUMN `quoteHash`;

ALTER TABLE `approval_grants`
  DROP COLUMN `quoteHash`,
  DROP COLUMN `quoteCeiling`,
  DROP COLUMN `currency`;

DROP TABLE `balance_transactions`;
DROP TABLE `balance_freezes`;
DROP TABLE `paid_beta_payment_attempts`;
DROP TABLE `paid_beta_seats`;
DROP TABLE `paid_beta_campaigns`;
DROP TABLE `subscription_grants`;
DROP TABLE `subscriptions`;
DROP TABLE `llm_billing_meters`;
DROP TABLE `usage_costs`;
DROP TABLE `user_balances`;
