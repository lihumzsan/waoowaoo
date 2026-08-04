-- Project assets remain the same domain identities. Their optional stable
-- association now belongs to an Asset Manifest item rather than a screenplay
-- entity registry. Historical associations are deliberately cleared because
-- their values were produced by a different owner and ID algorithm. A later
-- manifest adoption can attach the new identity to the same name without
-- replacing the real Project asset UUID.
ALTER TABLE `project_characters`
  DROP INDEX `project_characters_project_canonical_entity_key`,
  CHANGE COLUMN `canonicalEntityId` `manifestAssetId` VARCHAR(80) NULL;

ALTER TABLE `project_locations`
  DROP INDEX `project_locations_project_kind_canonical_entity_key`,
  CHANGE COLUMN `canonicalEntityId` `manifestAssetId` VARCHAR(80) NULL;

UPDATE `project_characters`
SET `manifestAssetId` = NULL;

UPDATE `project_locations`
SET `manifestAssetId` = NULL;

-- The binding role is reused by the new manifest contract, so preserve the old
-- relation as non-authoritative history instead of leaving it as the current
-- production manifest. Existing Resources, Project assets, and media remain
-- untouched.
UPDATE `creative_resource_bindings` AS `binding`
INNER JOIN `creative_resources` AS `resource`
  ON `resource`.`id` = `binding`.`resourceId`
SET `binding`.`role` = 'legacy_canonical_asset_manifest'
WHERE
  `binding`.`role` = 'adopted_asset_manifest'
  AND `binding`.`slotKey` = 'primary'
  AND `resource`.`schemaId` = 'project.asset_manifest';

CREATE UNIQUE INDEX `project_characters_project_manifest_asset_key`
  ON `project_characters`(`projectId`, `manifestAssetId`);

CREATE UNIQUE INDEX `project_locations_project_kind_manifest_asset_key`
  ON `project_locations`(`projectId`, `assetKind`, `manifestAssetId`);
