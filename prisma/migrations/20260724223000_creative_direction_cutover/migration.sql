-- Intentional empty-data cutover: legacy Style Bible resources do not satisfy
-- the Creative Direction identity or six-domain content contract.
DELETE FROM `creative_resource_lineage`
WHERE `inputRevisionId` IN (
  SELECT `id`
  FROM `creative_resource_revisions`
  WHERE `resourceId` IN (
    SELECT `id`
    FROM `creative_resources`
    WHERE `schemaId` = 'project.style_bible'
  )
)
OR `outputRevisionId` IN (
  SELECT `id`
  FROM `creative_resource_revisions`
  WHERE `resourceId` IN (
    SELECT `id`
    FROM `creative_resources`
    WHERE `schemaId` = 'project.style_bible'
  )
);

DELETE FROM `creative_resource_bindings`
WHERE `resourceId` IN (
  SELECT `id`
  FROM `creative_resources`
  WHERE `schemaId` = 'project.style_bible'
)
OR `revisionId` IN (
  SELECT `id`
  FROM `creative_resource_revisions`
  WHERE `resourceId` IN (
    SELECT `id`
    FROM `creative_resources`
    WHERE `schemaId` = 'project.style_bible'
  )
);

UPDATE `creative_resources`
SET `headRevisionId` = NULL
WHERE `schemaId` = 'project.style_bible';

DELETE FROM `creative_resource_revisions`
WHERE `resourceId` IN (
  SELECT `id`
  FROM `creative_resources`
  WHERE `schemaId` = 'project.style_bible'
);

DELETE FROM `creative_resources`
WHERE `schemaId` = 'project.style_bible';
