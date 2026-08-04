import { createConfigOperations } from './domains/config/config-ops'
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
import { createWorkspaceResourceGenerationOperations } from './domains/workspace-resource/generation-ops'
import { createWorkspaceResourceOperations } from './domains/workspace-resource/resource-ops'
import { createWorkspaceResourceUploadedMediaOperations } from './domains/workspace-resource/uploaded-media-ops'
import { createWorkspaceResourceVideoMergeOperations } from './domains/workspace-resource/video-merge-ops'
import { createWorkspaceResourceReferenceImageOperations } from './domains/workspace-resource/reference-image-ops'
import { createVoiceOperations } from './domains/voice/voice-ops'
import { createAssetDeleteOperations } from './domains/asset/delete'
import { withOperationPack } from './pack'
import type { ProjectAgentOperationRegistry } from './types'

const CONFIRM_NONE = {
  kind: 'none',
  required: false,
  summary: null,
  budget: null,
} as const

const API_ONLY = { tool: false, api: true, mcp: false } as const
const CAPABILITY_API = { tool: true, api: true, mcp: false } as const
const CAPABILITY_ONLY = { tool: true, api: false, mcp: false } as const

/**
 * The complete Wao Capability registry.
 *
 * `api` is the product UI/HTTP surface. `mcp` is an explicit per-operation
 * opt-in consumed by Codex. There is no longer a model-visible generic read,
 * model-side interaction, Web Search, Canon, or Worker pack here; ordinary
 * project knowledge is the WorkspaceResource folder and Codex owns those
 * native interaction/research capabilities.
 */
export function createProjectAgentOperationRegistry(): ProjectAgentOperationRegistry {
  return {
    ...withOperationPack(createAssetDeleteOperations(), {
      groupPath: ['asset'],
      channels: CAPABILITY_API,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createSystemProjectOperations(), {
      groupPath: ['project', 'system'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createTaskOperations(), {
      groupPath: ['task'],
      channels: CAPABILITY_API,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createSseOperations(), {
      groupPath: ['debug', 'sse'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createUserPreferenceOperations(), {
      groupPath: ['config', 'preference'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createUserModelsOperations(), {
      groupPath: ['config', 'models'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createUserBillingOperations(), {
      groupPath: ['billing'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createUserApiConfigOperations(), {
      groupPath: ['config', 'api'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssetHubFolderOperations(), {
      groupPath: ['asset-hub', 'folder'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssetHubCharacterLibraryOperations(), {
      groupPath: ['asset-hub', 'character-library'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssetHubCharacterAppearanceOperations(), {
      groupPath: ['asset-hub', 'character-appearance'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssetHubLocationLibraryOperations(), {
      groupPath: ['asset-hub', 'location-library'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createAssetHubPickerOperations(), {
      groupPath: ['asset-hub', 'picker'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createProjectCrudOperations(), {
      groupPath: ['project', 'crud'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createVoiceOperations(), {
      groupPath: ['media', 'voice'],
      channels: CAPABILITY_API,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createConfigOperations(), {
      groupPath: ['config'],
      channels: API_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createWorkspaceResourceGenerationOperations(), {
      groupPath: ['resource'],
      channels: CAPABILITY_API,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createWorkspaceResourceOperations(), {
      groupPath: ['resource'],
      channels: CAPABILITY_API,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createWorkspaceResourceVideoMergeOperations(), {
      groupPath: ['resource'],
      channels: CAPABILITY_API,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createWorkspaceResourceUploadedMediaOperations(), {
      groupPath: ['resource'],
      channels: CAPABILITY_ONLY,
      confirmation: CONFIRM_NONE,
    }),
    ...withOperationPack(createWorkspaceResourceReferenceImageOperations(), {
      groupPath: ['resource', 'import'],
      channels: CAPABILITY_ONLY,
      confirmation: CONFIRM_NONE,
    }),
  }
}
