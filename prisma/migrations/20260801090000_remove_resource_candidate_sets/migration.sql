ALTER TABLE `creative_resources`
  DROP INDEX `creative_resources_candidate_idx`,
  CHANGE COLUMN `candidateIndex` `memberIndex` INTEGER NULL,
  DROP COLUMN `candidateSetId`;
