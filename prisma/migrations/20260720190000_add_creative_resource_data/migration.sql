ALTER TABLE `creative_resources`
  ADD COLUMN `creativeData` JSON NULL,
  ADD COLUMN `creativeDataVersion` INTEGER NOT NULL DEFAULT 0;
