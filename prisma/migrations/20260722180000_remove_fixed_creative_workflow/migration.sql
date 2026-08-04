-- DropForeignKey
ALTER TABLE `project_edit_chapters` DROP FOREIGN KEY `project_edit_chapters_outputMediaId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_chapters` DROP FOREIGN KEY `project_edit_chapters_sourceDocumentId_fkey`;

-- DropForeignKey
ALTER TABLE `project_episode_source_documents` DROP FOREIGN KEY `project_episode_source_documents_rawFileMediaId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_style_previews` DROP FOREIGN KEY `project_edit_style_previews_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_style_previews` DROP FOREIGN KEY `project_edit_style_previews_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_style_previews` DROP FOREIGN KEY `project_edit_style_previews_editBibleId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_scripts` DROP FOREIGN KEY `project_edit_scripts_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_scripts` DROP FOREIGN KEY `project_edit_scripts_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_scripts` DROP FOREIGN KEY `project_edit_scripts_chapterId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_shot_execution_plans` DROP FOREIGN KEY `project_edit_shot_execution_plans_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_shot_execution_plans` DROP FOREIGN KEY `project_edit_shot_execution_plans_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_shot_execution_plans` DROP FOREIGN KEY `project_edit_shot_execution_plans_chapterId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_shot_execution_plans` DROP FOREIGN KEY `project_edit_shot_execution_plans_editScriptId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_asset_requirements` DROP FOREIGN KEY `project_edit_asset_requirements_editScriptId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_asset_requirements` DROP FOREIGN KEY `project_edit_asset_requirements_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_asset_requirements` DROP FOREIGN KEY `project_edit_asset_requirements_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_asset_requirements` DROP FOREIGN KEY `project_edit_asset_requirements_chapterId_fkey`;

-- DropForeignKey
ALTER TABLE `project_episode_final_outputs` DROP FOREIGN KEY `project_episode_final_outputs_outputMediaId_fkey`;

-- DropForeignKey
ALTER TABLE `project_episode_final_outputs` DROP FOREIGN KEY `project_episode_final_outputs_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_music_scores` DROP FOREIGN KEY `project_edit_music_scores_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_edit_bgm_designs` DROP FOREIGN KEY `project_edit_bgm_designs_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_video_segments` DROP FOREIGN KEY `project_video_segments_videoMediaId_fkey`;

-- DropForeignKey
ALTER TABLE `project_video_segments` DROP FOREIGN KEY `project_video_segments_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `project_video_segments` DROP FOREIGN KEY `project_video_segments_episodeId_fkey`;

-- DropForeignKey
ALTER TABLE `project_video_segments` DROP FOREIGN KEY `project_video_segments_chapterId_fkey`;

-- DropForeignKey
ALTER TABLE `project_video_segments` DROP FOREIGN KEY `project_video_segments_editScriptId_fkey`;

-- DropIndex
DROP INDEX `project_edit_chapters_outputMediaId_idx` ON `project_edit_chapters`;

-- DropIndex
DROP INDEX `project_edit_bibles_generationTaskId_idx` ON `project_edit_bibles`;

-- DropIndex
DROP INDEX `project_episode_source_documents_rawFileMediaId_idx` ON `project_episode_source_documents`;

-- This is an intentional empty-data cutover. The removed fixed workflow and
-- its retained source/Bible/Chapter projections cannot remain in flight while
-- their identities and required columns change.
DELETE FROM `project_edit_chapters`;
DELETE FROM `project_edit_bibles`;
DELETE FROM `project_episode_source_documents`;

-- AlterTable
ALTER TABLE `project_edit_chapters` DROP COLUMN `outputMediaId`,
    DROP COLUMN `renderStatus`,
    DROP COLUMN `renderTaskId`,
    DROP COLUMN `status`,
    MODIFY `title` VARCHAR(191) NOT NULL,
    MODIFY `summary` TEXT NOT NULL,
    MODIFY `sourceDocumentId` VARCHAR(191) NOT NULL,
    MODIFY `sourceStart` INTEGER NOT NULL,
    MODIFY `sourceEnd` INTEGER NOT NULL,
    MODIFY `targetDurationSec` INTEGER NOT NULL,
    MODIFY `entrySnapshotJson` JSON NOT NULL,
    MODIFY `eventsJson` JSON NOT NULL,
    MODIFY `provenanceJson` JSON NOT NULL;

-- AlterTable
ALTER TABLE `project_episode_source_documents` DROP COLUMN `rawFileMediaId`,
    DROP COLUMN `scriptStructureJson`,
    DROP COLUMN `sourceKind`,
    ADD COLUMN `sourceFingerprint` VARCHAR(64) NOT NULL,
    ADD COLUMN `sourceResourceId` VARCHAR(191) NOT NULL,
    ADD COLUMN `sourceRevisionId` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `project_edit_bibles` DROP COLUMN `diagnosticsJson`,
    DROP COLUMN `generationTaskId`,
    DROP COLUMN `lockedAt`,
    DROP COLUMN `status`,
    DROP COLUMN `styleBibleJson`,
    ADD COLUMN `bibleFingerprint` VARCHAR(64) NOT NULL,
    ADD COLUMN `bibleResourceId` VARCHAR(191) NOT NULL,
    ADD COLUMN `bibleRevisionId` VARCHAR(191) NOT NULL,
    MODIFY `bibleJson` JSON NOT NULL,
    MODIFY `beatSheetJson` JSON NOT NULL,
    MODIFY `ledgerJson` JSON NOT NULL,
    MODIFY `emotionalCurveJson` JSON NOT NULL;

-- AlterTable
ALTER TABLE `project_agent_activities` DROP COLUMN `choiceType`;

-- AlterTable
ALTER TABLE `projects` DROP COLUMN `videoRatioConfirmedAt`,
    DROP COLUMN `videoRatioConfirmationVersion`;

-- DropTable
DROP TABLE `project_edit_style_previews`;

-- DropTable
DROP TABLE `project_edit_scripts`;

-- DropTable
DROP TABLE `project_edit_shot_execution_plans`;

-- DropTable
DROP TABLE `project_edit_asset_requirements`;

-- DropTable
DROP TABLE `project_episode_final_outputs`;

-- DropTable
DROP TABLE `project_edit_music_scores`;

-- DropTable
DROP TABLE `project_edit_bgm_designs`;

-- DropTable
DROP TABLE `project_video_segments`;

-- CreateIndex
CREATE UNIQUE INDEX `project_episode_source_documents_episodeId_sourceRevisionId_key` ON `project_episode_source_documents`(`episodeId`, `sourceRevisionId`);

-- CreateIndex
CREATE INDEX `project_episode_source_documents_sourceResourceId_idx` ON `project_episode_source_documents`(`sourceResourceId`);

-- CreateIndex
CREATE INDEX `project_edit_bibles_bibleRevisionId_idx` ON `project_edit_bibles`(`bibleRevisionId`);

-- CreateIndex
CREATE INDEX `project_edit_bibles_bibleResourceId_idx` ON `project_edit_bibles`(`bibleResourceId`);

-- AddForeignKey
ALTER TABLE `project_edit_chapters` ADD CONSTRAINT `project_edit_chapters_sourceDocumentId_fkey` FOREIGN KEY (`sourceDocumentId`) REFERENCES `project_episode_source_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
