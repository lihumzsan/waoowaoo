ALTER TABLE `projects`
  ADD COLUMN `videoRatioConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN `videoRatioConfirmationVersion` INTEGER NOT NULL DEFAULT 0;
