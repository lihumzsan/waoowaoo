ALTER TABLE `novel_promotion_episodes`
  ADD COLUMN `coverImageMediaId` VARCHAR(191) NULL;

CREATE INDEX `novel_promotion_episodes_coverImageMediaId_idx`
  ON `novel_promotion_episodes`(`coverImageMediaId`);

ALTER TABLE `novel_promotion_episodes`
  ADD CONSTRAINT `novel_promotion_episodes_coverImageMediaId_fkey`
  FOREIGN KEY (`coverImageMediaId`) REFERENCES `media_objects`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
