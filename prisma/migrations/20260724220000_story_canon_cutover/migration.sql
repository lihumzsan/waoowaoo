-- Intentional empty-data cutover: the project is pre-release and legacy Edit Bible
-- rows do not satisfy the Story Canon identity or content contract.
DROP TABLE `project_edit_bibles`;

CREATE TABLE `project_story_canons` (
  `id` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `sourceDocumentId` VARCHAR(191) NOT NULL,
  `storyCanonJson` JSON NOT NULL,
  `beatSheetJson` JSON NOT NULL,
  `ledgerJson` JSON NOT NULL,
  `emotionalCurveJson` JSON NOT NULL,
  `storyCanonResourceId` VARCHAR(191) NOT NULL,
  `storyCanonRevisionId` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_story_canons_episodeId_key`(`episodeId`),
  INDEX `project_story_canons_episodeId_idx`(`episodeId`),
  INDEX `project_story_canons_sourceDocumentId_idx`(`sourceDocumentId`),
  INDEX `project_story_canons_storyCanonResourceId_idx`(`storyCanonResourceId`),
  INDEX `project_story_canons_storyCanonRevisionId_idx`(`storyCanonRevisionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_story_canons`
  ADD CONSTRAINT `project_story_canons_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_story_canons`
  ADD CONSTRAINT `project_story_canons_sourceDocumentId_fkey`
  FOREIGN KEY (`sourceDocumentId`) REFERENCES `project_episode_source_documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
