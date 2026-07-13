-- Rewrite only mutable model selections. Historical tasks, task events, and
-- graph runs intentionally remain unchanged as audit records.
SET @old_workflow = _utf8mb4'basevideo/ltx23-profiles/t8-smooth-first-last-frame' COLLATE utf8mb4_unicode_ci;
SET @new_workflow = _utf8mb4'basevideo/ltx23-profiles/goon-first-last-frame-2stage' COLLATE utf8mb4_unicode_ci;

UPDATE `novel_promotion_projects`
SET `videoModel` = REPLACE(`videoModel`, @old_workflow, @new_workflow)
WHERE `videoModel` LIKE CONCAT('%', @old_workflow, '%');

UPDATE `novel_promotion_projects`
SET `capabilityOverrides` = REPLACE(`capabilityOverrides`, @old_workflow, @new_workflow)
WHERE `capabilityOverrides` LIKE CONCAT('%', @old_workflow, '%');

UPDATE `novel_promotion_panels`
SET `videoModel` = REPLACE(`videoModel`, @old_workflow, @new_workflow)
WHERE `videoModel` LIKE CONCAT('%', @old_workflow, '%');

UPDATE `user_preferences`
SET `videoModel` = REPLACE(`videoModel`, @old_workflow, @new_workflow)
WHERE `videoModel` LIKE CONCAT('%', @old_workflow, '%');

UPDATE `user_preferences`
SET `customModels` = REPLACE(`customModels`, @old_workflow, @new_workflow)
WHERE `customModels` LIKE CONCAT('%', @old_workflow, '%');

UPDATE `user_preferences`
SET `capabilityDefaults` = REPLACE(`capabilityDefaults`, @old_workflow, @new_workflow)
WHERE `capabilityDefaults` LIKE CONCAT('%', @old_workflow, '%');
