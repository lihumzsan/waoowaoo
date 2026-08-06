-- LLM usage keeps exact retail credits while the balance ledger remains an
-- integer-credit ledger. Existing media rows are whole numbers and convert
-- losslessly to DECIMAL(18,6).
ALTER TABLE `usage_costs`
  MODIFY COLUMN `cost` DECIMAL(18,6) NOT NULL,
  ADD COLUMN `chargedCredits` INT NOT NULL DEFAULT 0;

-- Historical positive UsageCost rows were already settled as whole-credit
-- media charges. Zero-cost legacy LLM facts remain zero and are never swept.
UPDATE `usage_costs`
SET `chargedCredits` = CAST(`cost` AS SIGNED)
WHERE `cost` > 0;

-- One rounding carry per user lets realtime generation settlement charge only
-- the delta when cumulative exact usage crosses a whole-credit boundary.
CREATE TABLE `llm_billing_meters` (
  `userId` VARCHAR(191) NOT NULL,
  `prepaidMicrocredits` BIGINT NOT NULL DEFAULT 0,
  `totalRetailMicrocredits` BIGINT NOT NULL DEFAULT 0,
  `totalChargedCredits` INT NOT NULL DEFAULT 0,
  `totalUncoveredMicrocredits` BIGINT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`userId`),
  CONSTRAINT `llm_billing_meters_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
