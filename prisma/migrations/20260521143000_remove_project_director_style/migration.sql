DELETE FROM `user_style_presets`
WHERE `kind` = 'director_style';

ALTER TABLE `projects`
  DROP COLUMN `directorStylePresetId`,
  DROP COLUMN `directorStyleDoc`,
  DROP COLUMN `directorStylePresetSource`;
