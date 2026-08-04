import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import { withOperationPack } from '@/lib/operations/pack'
import { createAssetHubApiOperations } from './asset-hub-api-ops'
import { createAssetsApiOperations } from './assets-api-ops'
import { createMediaUploadApiOperations } from './media-upload-api-ops'
import { createUserApiConfigConnectionDiagnosticOperations } from './user-api-config-connection-ops'

export function createApiOnlyOperationRegistry(): ProjectAgentOperationRegistry {
  return withOperationPack({
    ...createAssetsApiOperations(),
    ...createAssetHubApiOperations(),
    ...createMediaUploadApiOperations(),
    ...createUserApiConfigConnectionDiagnosticOperations(),
  }, {
    groupPath: ['api-only'],
    channels: { tool: false, api: true, mcp: false },
    confirmation: { kind: 'none', required: false, summary: null, budget: null },
  })
}
