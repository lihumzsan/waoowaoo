CREATE UNIQUE INDEX `project_characters_projectId_name_key`
  ON `project_characters` (`projectId`, `name`);

CREATE UNIQUE INDEX `project_locations_projectId_assetKind_name_key`
  ON `project_locations` (`projectId`, `assetKind`, `name`);
