ALTER TABLE `workspace_resources`
  ADD COLUMN `selectedVoiceVersionId` VARCHAR(191) NULL,
  ADD COLUMN `selectedVoiceRevision` INTEGER NOT NULL DEFAULT 0,
  ADD INDEX `workspace_resources_selected_voice_idx` (`selectedVoiceVersionId`);

ALTER TABLE `workspace_resources`
  ADD CONSTRAINT `workspace_resources_selectedVoiceVersionId_fkey`
  FOREIGN KEY (`selectedVoiceVersionId`) REFERENCES `workspace_resource_versions` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
