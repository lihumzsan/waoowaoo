UPDATE `project_characters` pc
JOIN (
  SELECT
    ranked.`id`,
    CONCAT(LEFT(ranked.`name`, 150), ' [', LEFT(ranked.`id`, 36), ']') AS `dedupedName`
  FROM (
    SELECT
      `id`,
      `projectId`,
      `name`,
      ROW_NUMBER() OVER (
        PARTITION BY `projectId`, `name`
        ORDER BY `createdAt` ASC, `id` ASC
      ) AS `duplicateRank`
    FROM `project_characters`
  ) ranked
  WHERE ranked.`duplicateRank` > 1
) duplicates ON duplicates.`id` = pc.`id`
SET pc.`name` = duplicates.`dedupedName`;

CREATE UNIQUE INDEX `project_characters_projectId_name_key`
  ON `project_characters` (`projectId`, `name`);

UPDATE `project_locations` pl
JOIN (
  SELECT
    ranked.`id`,
    CONCAT(LEFT(ranked.`name`, 150), ' [', LEFT(ranked.`id`, 36), ']') AS `dedupedName`
  FROM (
    SELECT
      `id`,
      `projectId`,
      `assetKind`,
      `name`,
      ROW_NUMBER() OVER (
        PARTITION BY `projectId`, `assetKind`, `name`
        ORDER BY `createdAt` ASC, `id` ASC
      ) AS `duplicateRank`
    FROM `project_locations`
  ) ranked
  WHERE ranked.`duplicateRank` > 1
) duplicates ON duplicates.`id` = pl.`id`
SET pl.`name` = duplicates.`dedupedName`;

CREATE UNIQUE INDEX `project_locations_projectId_assetKind_name_key`
  ON `project_locations` (`projectId`, `assetKind`, `name`);
