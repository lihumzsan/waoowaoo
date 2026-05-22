CREATE TABLE `novel_promotion_panel_video_segments` (
  `id` VARCHAR(191) NOT NULL,
  `panelId` VARCHAR(191) NOT NULL,
  `segmentIndex` INTEGER NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `videoUrl` LONGTEXT NULL,
  `tailFrameImageUrl` LONGTEXT NULL,
  `dialogueText` LONGTEXT NULL,
  `prompt` LONGTEXT NULL,
  `audioDurationMs` INTEGER NULL,
  `targetDurationSeconds` DOUBLE NULL,
  `targetFrameCount` INTEGER NULL,
  `errorMessage` LONGTEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `novel_promotion_panel_video_segments_panelId_segmentIndex_key`(`panelId`, `segmentIndex`),
  INDEX `novel_promotion_panel_video_segments_panelId_idx`(`panelId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `novel_promotion_panel_video_segments`
  ADD CONSTRAINT `novel_promotion_panel_video_segments_panelId_fkey`
  FOREIGN KEY (`panelId`) REFERENCES `novel_promotion_panels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
