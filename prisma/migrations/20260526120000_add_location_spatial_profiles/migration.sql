ALTER TABLE `location_images`
  ADD COLUMN `spatialProfileJson` JSON NULL,
  ADD COLUMN `spatialProfileStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
  ADD COLUMN `spatialProfileError` LONGTEXT NULL,
  ADD COLUMN `spatialProfileAnalyzedAt` DATETIME(3) NULL,
  ADD COLUMN `spatialProfileModel` VARCHAR(191) NULL;

ALTER TABLE `global_location_images`
  ADD COLUMN `spatialProfileJson` JSON NULL,
  ADD COLUMN `spatialProfileStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
  ADD COLUMN `spatialProfileError` LONGTEXT NULL,
  ADD COLUMN `spatialProfileAnalyzedAt` DATETIME(3) NULL,
  ADD COLUMN `spatialProfileModel` VARCHAR(191) NULL;
