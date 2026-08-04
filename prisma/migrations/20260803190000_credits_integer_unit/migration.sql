-- Credits become an integer unit.
--
-- Balances were DECIMAL(18,6) and a credit was worth CNY 1, so the ledger
-- carried six decimal places of a unit users saw as money. A credit is now
-- worth CNY 0.1 and is always a whole number: existing amounts are multiplied
-- by 10 and rounded, then the columns become INT so no fractional credit can
-- be written again.
--
-- Rounding note: pre-existing rows can carry sub-0.1-credit dust, so the
-- reconcile invariant (balance + frozenAmount == SUM(transaction amounts)) may
-- drift by a credit or two on historical development rows. New writes cannot
-- drift, because every amount that reaches the ledger is a whole credit.

UPDATE `user_balances`
SET `balance` = ROUND(`balance` * 10),
    `frozenAmount` = ROUND(`frozenAmount` * 10),
    `totalSpent` = ROUND(`totalSpent` * 10);

UPDATE `balance_freezes` SET `amount` = ROUND(`amount` * 10);

UPDATE `balance_transactions`
SET `amount` = ROUND(`amount` * 10),
    `balanceAfter` = ROUND(`balanceAfter` * 10);

UPDATE `usage_costs` SET `cost` = ROUND(`cost` * 10);

UPDATE `invite_codes` SET `amount` = ROUND(`amount` * 10);

UPDATE `invite_redemptions` SET `amount` = ROUND(`amount` * 10);

UPDATE `approval_grants` SET `quoteCeiling` = ROUND(`quoteCeiling` * 10) WHERE `quoteCeiling` IS NOT NULL;

ALTER TABLE `user_balances`
  MODIFY COLUMN `balance` INT NOT NULL DEFAULT 0,
  MODIFY COLUMN `frozenAmount` INT NOT NULL DEFAULT 0,
  MODIFY COLUMN `totalSpent` INT NOT NULL DEFAULT 0;

ALTER TABLE `balance_freezes` MODIFY COLUMN `amount` INT NOT NULL;

ALTER TABLE `balance_transactions`
  MODIFY COLUMN `amount` INT NOT NULL,
  MODIFY COLUMN `balanceAfter` INT NOT NULL;

ALTER TABLE `usage_costs` MODIFY COLUMN `cost` INT NOT NULL;

ALTER TABLE `invite_codes` MODIFY COLUMN `amount` INT NOT NULL;

ALTER TABLE `invite_redemptions` MODIFY COLUMN `amount` INT NOT NULL;

ALTER TABLE `approval_grants` MODIFY COLUMN `quoteCeiling` INT NULL;
