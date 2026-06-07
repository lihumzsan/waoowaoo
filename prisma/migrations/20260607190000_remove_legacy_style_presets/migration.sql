DROP TABLE IF EXISTS `user_style_presets`;

ALTER TABLE `projects`
  DROP COLUMN `artStyle`,
  DROP COLUMN `artStylePrompt`,
  DROP COLUMN `visualStylePresetSource`,
  DROP COLUMN `visualStylePresetId`;

ALTER TABLE `user_preferences`
  DROP COLUMN `artStyle`;

ALTER TABLE `global_character_appearances`
  DROP COLUMN `artStyle`;

ALTER TABLE `global_locations`
  DROP COLUMN `artStyle`;
