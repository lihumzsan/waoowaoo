-- Phase 2 long-form global layer.
-- This migration creates immutable episode source documents and episode-scoped edit bibles.
-- It also adds task batch grouping metadata for future chapter batch orchestration.
-- Before applying it to any non-throwaway database, create and verify a database backup.

CREATE TABLE `project_episode_source_documents` (
  `id` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `normalizedText` LONGTEXT NOT NULL,
  `checksum` VARCHAR(64) NOT NULL,
  `sourceKind` VARCHAR(64) NOT NULL,
  `rawFileMediaId` VARCHAR(191) NULL,
  `version` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_episode_source_documents_episodeId_version_key`(`episodeId`, `version`),
  INDEX `project_episode_source_documents_episodeId_idx`(`episodeId`),
  INDEX `project_episode_source_documents_rawFileMediaId_idx`(`rawFileMediaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_edit_bibles` (
  `id` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `sourceDocumentId` VARCHAR(191) NOT NULL,
  `bibleJson` JSON NULL,
  `beatSheetJson` JSON NULL,
  `ledgerJson` JSON NULL,
  `emotionalCurveJson` JSON NULL,
  `styleBibleJson` JSON NULL,
  `diagnosticsJson` JSON NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `lockedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_edit_bibles_episodeId_key`(`episodeId`),
  INDEX `project_edit_bibles_episodeId_idx`(`episodeId`),
  INDEX `project_edit_bibles_sourceDocumentId_idx`(`sourceDocumentId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `project_edit_chapters_sourceDocumentId_idx`
  ON `project_edit_chapters`(`sourceDocumentId`);

ALTER TABLE `tasks`
  ADD COLUMN `batchKey` VARCHAR(191) NULL;

CREATE INDEX `tasks_batchKey_idx` ON `tasks`(`batchKey`);

ALTER TABLE `project_episode_source_documents`
  ADD CONSTRAINT `project_episode_source_documents_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_episode_source_documents`
  ADD CONSTRAINT `project_episode_source_documents_rawFileMediaId_fkey`
  FOREIGN KEY (`rawFileMediaId`) REFERENCES `media_objects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `project_edit_bibles`
  ADD CONSTRAINT `project_edit_bibles_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `project_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_edit_bibles`
  ADD CONSTRAINT `project_edit_bibles_sourceDocumentId_fkey`
  FOREIGN KEY (`sourceDocumentId`) REFERENCES `project_episode_source_documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `project_edit_chapters`
  ADD CONSTRAINT `project_edit_chapters_sourceDocumentId_fkey`
  FOREIGN KEY (`sourceDocumentId`) REFERENCES `project_episode_source_documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
