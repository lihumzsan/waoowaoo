ALTER TABLE `project_episode_source_documents`
  ADD COLUMN `scriptStructureJson` JSON NULL;

UPDATE `project_episode_source_documents` AS source_document
INNER JOIN `project_edit_bibles` AS edit_bible
  ON edit_bible.`sourceDocumentId` = source_document.`id`
SET source_document.`scriptStructureJson` = JSON_EXTRACT(edit_bible.`diagnosticsJson`, '$.scriptStructure')
WHERE source_document.`sourceKind` = 'prompt_generated_script'
  AND edit_bible.`diagnosticsJson` IS NOT NULL
  AND JSON_EXTRACT(edit_bible.`diagnosticsJson`, '$.scriptStructure') IS NOT NULL;
