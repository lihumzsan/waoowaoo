import { createReadOperations } from './domains/project/read-ops'
import { createGuiOperations } from './domains/gui/gui-ops'
import { createConfigOperations } from './domains/config/config-ops'
import { createProjectDataOperations } from './domains/project/project-data-ops'
import { createProjectCrudOperations } from './domains/project/project-crud-ops'
import { createSystemProjectOperations } from './domains/project/system-project-ops'
import { createTaskOperations } from './domains/task/task-ops'
import { createSseOperations } from './domains/debug/sse-ops'
import { createAssetHubFolderOperations } from './domains/asset-hub/asset-hub-folder-ops'
import { createAssetHubCharacterLibraryOperations } from './domains/asset-hub/asset-hub-character-library-ops'
import { createAssetHubCharacterAppearanceOperations } from './domains/asset-hub/asset-hub-character-appearance-ops'
import { createAssetHubLocationLibraryOperations } from './domains/asset-hub/asset-hub-location-library-ops'
import { createAssetHubPickerOperations } from './domains/asset-hub/asset-hub-picker-ops'
import { createUserPreferenceOperations } from './domains/config/user-preference-ops'
import { createUserModelsOperations } from './domains/config/user-models-ops'
import { createUserBillingOperations } from './domains/billing/user-billing-ops'
import { createUserApiConfigOperations } from './domains/config/user-api-config-ops'
import { createAuthOperations } from './domains/auth/auth-ops'
import { createCreativeResourceGenerationOperations } from './domains/creative-resource/generation-ops'
import { createCreativeResourceOperations } from './domains/creative-resource/resource-ops'
import { createCreativeResourceVideoMergeOperations } from './domains/creative-resource/video-merge-ops'
import { createAssistantPlanOperations } from './domains/assistant/plan-ops'
import { createAssistantCreativeOperations } from './domains/assistant/creative-ops'
import { createAssistantStoryCanonOperations } from './domains/assistant/creative-story-canon-ops'
import { createAssistantCreativeDirectionOperations } from './domains/assistant/creative-direction-ops'
import { createAssistantCreativeAssetOperations } from './domains/assistant/creative-asset-ops'
import { createAssistantChoiceOperations } from './domains/assistant/choice-ops'
import { createVoiceOperations } from './domains/voice/voice-ops'
import { withOperationPack } from './pack'
import type { ProjectAgentOperationRegistry } from './types'

export function createProjectAgentOperationRegistry(): ProjectAgentOperationRegistry {
  const CONFIRM_NONE = { kind: 'none', required: false, summary: null, budget: null } as const
  const CHANNELS_TOOL_API = { tool: true, api: true } as const
  const CHANNELS_API_ONLY = { tool: false, api: true } as const
  const PREREQ_EPISODE_OPTIONAL = { episodeId: 'optional' } as const

  return {
    ...withOperationPack(createAssistantChoiceOperations(), {
      groupPath: ['assistant', 'choice'],
      channels: { tool: true, api: false },
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssistantPlanOperations(), {
      groupPath: ['assistant', 'plan'],
      channels: { tool: true, api: false },
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssistantCreativeOperations(), {
      groupPath: ['assistant', 'creative'],
      channels: { tool: true, api: false },
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssistantStoryCanonOperations(), {
      groupPath: ['assistant', 'creative'],
      channels: { tool: true, api: false },
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssistantCreativeDirectionOperations(), {
      groupPath: ['assistant', 'creative'],
      channels: { tool: true, api: false },
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssistantCreativeAssetOperations(), {
      groupPath: ['assistant', 'creative'],
      channels: { tool: true, api: false },
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createSystemProjectOperations(), {
      groupPath: ['project', 'system'],
      channels: CHANNELS_TOOL_API,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createTaskOperations(), {
      groupPath: ['task'],
      channels: CHANNELS_TOOL_API,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createSseOperations(), {
      groupPath: ['debug', 'sse'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAuthOperations(), {
      groupPath: ['auth'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createUserPreferenceOperations(), {
      groupPath: ['config', 'preference'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createUserModelsOperations(), {
      groupPath: ['config', 'models'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createUserBillingOperations(), {
      groupPath: ['billing'],
      channels: CHANNELS_TOOL_API,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createUserApiConfigOperations(), {
      groupPath: ['config', 'api'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssetHubFolderOperations(), {
      groupPath: ['asset-hub', 'folder'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssetHubCharacterLibraryOperations(), {
      groupPath: ['asset-hub', 'character-library'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssetHubCharacterAppearanceOperations(), {
      groupPath: ['asset-hub', 'character-appearance'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssetHubLocationLibraryOperations(), {
      groupPath: ['asset-hub', 'location-library'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssetHubPickerOperations(), {
      groupPath: ['asset-hub', 'picker'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createReadOperations(), {
      groupPath: ['project', 'read'],
      channels: CHANNELS_TOOL_API,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createProjectCrudOperations(), {
      groupPath: ['project', 'crud'],
      channels: CHANNELS_TOOL_API,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createVoiceOperations(), {
      groupPath: ['media', 'voice'],
      channels: CHANNELS_TOOL_API,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createConfigOperations(), {
      groupPath: ['config'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createProjectDataOperations(), {
      groupPath: ['project', 'data'],
      channels: CHANNELS_TOOL_API,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createGuiOperations(), {
      groupPath: ['gui'],
      channels: CHANNELS_API_ONLY,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createCreativeResourceGenerationOperations(), {
      groupPath: ['resource'],
      channels: CHANNELS_TOOL_API,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createCreativeResourceOperations(), {
      groupPath: ['resource'],
      channels: CHANNELS_TOOL_API,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createCreativeResourceVideoMergeOperations(), {
      groupPath: ['resource'],
      channels: CHANNELS_TOOL_API,
      prerequisites: PREREQ_EPISODE_OPTIONAL,
      confirmation: CONFIRM_NONE,
    }),
  }
}
