-- Exact Creative Resource identity is the globally unique immutable Revision ID.
-- Fingerprints remain only for execution/idempotency protocols, not Resource identity.
ALTER TABLE `creative_resource_revisions`
  DROP INDEX `creative_revisions_fingerprint_idx`,
  DROP COLUMN `fingerprint`;

ALTER TABLE `project_episode_source_documents`
  DROP COLUMN `sourceFingerprint`;

ALTER TABLE `project_edit_bibles`
  DROP COLUMN `bibleFingerprint`;

-- Direct canonical-entity association on the existing Project asset owners.
ALTER TABLE `project_characters`
  ADD COLUMN `canonicalEntityId` VARCHAR(80) NULL;

ALTER TABLE `project_locations`
  ADD COLUMN `canonicalEntityId` VARCHAR(80) NULL;

CREATE UNIQUE INDEX `project_characters_project_canonical_entity_key`
  ON `project_characters`(`projectId`, `canonicalEntityId`);

CREATE UNIQUE INDEX `project_locations_project_kind_canonical_entity_key`
  ON `project_locations`(`projectId`, `assetKind`, `canonicalEntityId`);
