CREATE TABLE `novel_promotion_free_voice_records` (
  `id` VARCHAR(191) NOT NULL,
  `novelPromotionProjectId` VARCHAR(191) NOT NULL,
  `text` TEXT NOT NULL,
  `characterId` VARCHAR(191) NULL,
  `characterName` VARCHAR(191) NOT NULL,
  `voiceSourceType` VARCHAR(191) NOT NULL,
  `voiceSourceId` VARCHAR(191) NULL,
  `voiceName` VARCHAR(191) NOT NULL,
  `referenceAudioUrl` TEXT NOT NULL,
  `referenceAudioMediaId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `np_free_voice_records_project_created_idx` (`novelPromotionProjectId`, `createdAt`),
  INDEX `np_free_voice_records_reference_media_idx` (`referenceAudioMediaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `novel_promotion_free_voice_versions` (
  `id` VARCHAR(191) NOT NULL,
  `recordId` VARCHAR(191) NOT NULL,
  `versionNumber` INTEGER NOT NULL,
  `audioModel` VARCHAR(191) NOT NULL,
  `audioUrl` TEXT NULL,
  `audioMediaId` VARCHAR(191) NULL,
  `audioDuration` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `np_free_voice_versions_record_number_key` (`recordId`, `versionNumber`),
  INDEX `np_free_voice_versions_record_created_idx` (`recordId`, `createdAt`),
  INDEX `np_free_voice_versions_audio_media_idx` (`audioMediaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `novel_promotion_free_voice_records`
  ADD CONSTRAINT `np_free_voice_records_project_fkey`
  FOREIGN KEY (`novelPromotionProjectId`) REFERENCES `novel_promotion_projects`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `novel_promotion_free_voice_records`
  ADD CONSTRAINT `np_free_voice_records_reference_media_fkey`
  FOREIGN KEY (`referenceAudioMediaId`) REFERENCES `media_objects`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `novel_promotion_free_voice_versions`
  ADD CONSTRAINT `np_free_voice_versions_record_fkey`
  FOREIGN KEY (`recordId`) REFERENCES `novel_promotion_free_voice_records`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `novel_promotion_free_voice_versions`
  ADD CONSTRAINT `np_free_voice_versions_audio_media_fkey`
  FOREIGN KEY (`audioMediaId`) REFERENCES `media_objects`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
