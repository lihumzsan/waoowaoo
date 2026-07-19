-- Free voice has moved to the standalone video tools page and is now Redis-only.
-- Remove legacy project-scoped free voice history; version rows cascade from records.
CREATE TEMPORARY TABLE `_free_voice_audio_media_to_delete` (
  `id` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY
);

INSERT IGNORE INTO `_free_voice_audio_media_to_delete` (`id`)
SELECT DISTINCT `audioMediaId`
FROM `novel_promotion_free_voice_versions`
WHERE `audioMediaId` IS NOT NULL;

INSERT IGNORE INTO `_free_voice_audio_media_to_delete` (`id`)
SELECT `id`
FROM `media_objects`
WHERE `storageKey` IN (
  'voice/free/1b839fd3-240d-421c-b0c7-18594cf60afb/c9d55358-2b21-4281-908e-f7d1b6a92912/437cc705-0ce8-47be-91a1-60bf34a0f8f9.mp3',
  'voice/free/1b839fd3-240d-421c-b0c7-18594cf60afb/196fb4cf-f43a-4dc6-ada2-cbe6cc72299f/8cf4c3ea-e34e-4150-b37d-60dc6d00e813.mp3',
  'voice/free/1b839fd3-240d-421c-b0c7-18594cf60afb/f3278dbb-a7e9-4274-8302-026c666e7a7a/e080717c-0c4d-4a12-94a9-603ff5e3922c.mp3'
);

DELETE FROM `tasks`
WHERE `type` = 'free_voice'
  AND `targetType` = 'NovelPromotionFreeVoiceVersion';

DELETE FROM `novel_promotion_free_voice_records`;

DELETE `media_objects`
FROM `media_objects`
INNER JOIN `_free_voice_audio_media_to_delete` AS `candidate`
  ON `candidate`.`id` = `media_objects`.`id`
WHERE NOT EXISTS (SELECT 1 FROM `character_appearances` WHERE `imageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `location_images` WHERE `imageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_characters` WHERE `customVoiceMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_episodes` WHERE `audioMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_panels` WHERE `imageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_panels` WHERE `videoMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_panels` WHERE `lipSyncVideoMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_panels` WHERE `sketchImageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_panels` WHERE `previousImageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_shots` WHERE `imageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `supplementary_panels` WHERE `imageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_voice_lines` WHERE `audioMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_free_voice_records` WHERE `referenceAudioMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `novel_promotion_free_voice_versions` WHERE `audioMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `voice_presets` WHERE `audioMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `global_characters` WHERE `customVoiceMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `global_character_appearances` WHERE `imageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `global_character_appearances` WHERE `previousImageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `global_location_images` WHERE `imageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `global_location_images` WHERE `previousImageMediaId` = `media_objects`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `global_voices` WHERE `customVoiceMediaId` = `media_objects`.`id`);

DROP TEMPORARY TABLE `_free_voice_audio_media_to_delete`;
