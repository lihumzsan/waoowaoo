-- A single database-owned monotonic revision orders every persisted snapshot
-- consumed by the episodeData and editBible Query DTOs. Child triggers run in
-- the caller's transaction, so deletes and same-timestamp writes cannot be
-- missed by terminal materialization.
ALTER TABLE `project_episodes`
  ADD COLUMN `resourceRevision` INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER `project_episode_resource_revision_update`
BEFORE UPDATE ON `project_episodes`
FOR EACH ROW
SET NEW.`resourceRevision` = IF(
  NEW.`resourceRevision` = OLD.`resourceRevision`,
  OLD.`resourceRevision` + 1,
  NEW.`resourceRevision`
);

CREATE TRIGGER `source_document_resource_revision_insert`
AFTER INSERT ON `project_episode_source_documents`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `source_document_resource_revision_update`
AFTER UPDATE ON `project_episode_source_documents`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `source_document_resource_revision_delete`
AFTER DELETE ON `project_episode_source_documents`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `edit_chapter_resource_revision_insert`
AFTER INSERT ON `project_edit_chapters`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `edit_chapter_resource_revision_update`
AFTER UPDATE ON `project_edit_chapters`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `edit_chapter_resource_revision_delete`
AFTER DELETE ON `project_edit_chapters`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `edit_bible_resource_revision_insert`
AFTER INSERT ON `project_edit_bibles`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `edit_bible_resource_revision_update`
AFTER UPDATE ON `project_edit_bibles`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `edit_bible_resource_revision_delete`
AFTER DELETE ON `project_edit_bibles`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `style_preview_resource_revision_insert`
AFTER INSERT ON `project_edit_style_previews`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `style_preview_resource_revision_update`
AFTER UPDATE ON `project_edit_style_previews`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `style_preview_resource_revision_delete`
AFTER DELETE ON `project_edit_style_previews`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `edit_script_resource_revision_insert`
AFTER INSERT ON `project_edit_scripts`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `edit_script_resource_revision_update`
AFTER UPDATE ON `project_edit_scripts`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `edit_script_resource_revision_delete`
AFTER DELETE ON `project_edit_scripts`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `shot_plan_resource_revision_insert`
AFTER INSERT ON `project_edit_shot_execution_plans`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `shot_plan_resource_revision_update`
AFTER UPDATE ON `project_edit_shot_execution_plans`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `shot_plan_resource_revision_delete`
AFTER DELETE ON `project_edit_shot_execution_plans`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `asset_requirement_resource_revision_insert`
AFTER INSERT ON `project_edit_asset_requirements`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `asset_requirement_resource_revision_update`
AFTER UPDATE ON `project_edit_asset_requirements`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `asset_requirement_resource_revision_delete`
AFTER DELETE ON `project_edit_asset_requirements`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `final_output_resource_revision_insert`
AFTER INSERT ON `project_episode_final_outputs`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `final_output_resource_revision_update`
AFTER UPDATE ON `project_episode_final_outputs`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `final_output_resource_revision_delete`
AFTER DELETE ON `project_episode_final_outputs`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `music_score_resource_revision_insert`
AFTER INSERT ON `project_edit_music_scores`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `music_score_resource_revision_update`
AFTER UPDATE ON `project_edit_music_scores`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `music_score_resource_revision_delete`
AFTER DELETE ON `project_edit_music_scores`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `soundscape_resource_revision_insert`
AFTER INSERT ON `project_edit_soundscapes`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `soundscape_resource_revision_update`
AFTER UPDATE ON `project_edit_soundscapes`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `soundscape_resource_revision_delete`
AFTER DELETE ON `project_edit_soundscapes`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `video_group_resource_revision_insert`
AFTER INSERT ON `project_video_groups`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `video_group_resource_revision_update`
AFTER UPDATE ON `project_video_groups`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `video_group_resource_revision_delete`
AFTER DELETE ON `project_video_groups`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `storyboard_resource_revision_insert`
AFTER INSERT ON `project_storyboards`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = NEW.`episodeId`;
CREATE TRIGGER `storyboard_resource_revision_update`
AFTER UPDATE ON `project_storyboards`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` IN (OLD.`episodeId`, NEW.`episodeId`);
CREATE TRIGGER `storyboard_resource_revision_delete`
AFTER DELETE ON `project_storyboards`
FOR EACH ROW UPDATE `project_episodes` SET `resourceRevision` = `resourceRevision` + 1 WHERE `id` = OLD.`episodeId`;

CREATE TRIGGER `panel_resource_revision_insert`
AFTER INSERT ON `project_panels`
FOR EACH ROW UPDATE `project_episodes` AS episode
  INNER JOIN `project_storyboards` AS storyboard ON storyboard.`episodeId` = episode.`id`
  SET episode.`resourceRevision` = episode.`resourceRevision` + 1
  WHERE storyboard.`id` = NEW.`storyboardId`;
CREATE TRIGGER `panel_resource_revision_update`
AFTER UPDATE ON `project_panels`
FOR EACH ROW UPDATE `project_episodes` AS episode
  INNER JOIN `project_storyboards` AS storyboard ON storyboard.`episodeId` = episode.`id`
  SET episode.`resourceRevision` = episode.`resourceRevision` + 1
  WHERE storyboard.`id` IN (OLD.`storyboardId`, NEW.`storyboardId`);
CREATE TRIGGER `panel_resource_revision_delete`
AFTER DELETE ON `project_panels`
FOR EACH ROW UPDATE `project_episodes` AS episode
  INNER JOIN `project_storyboards` AS storyboard ON storyboard.`episodeId` = episode.`id`
  SET episode.`resourceRevision` = episode.`resourceRevision` + 1
  WHERE storyboard.`id` = OLD.`storyboardId`;
