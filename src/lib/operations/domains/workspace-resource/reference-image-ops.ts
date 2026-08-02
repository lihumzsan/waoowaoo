import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'

/**
 * Web search returns references only. Importing remote bytes is deliberately
 * absent until it has a declared Task type/handler and outbound-download
 * policy; exposing a synchronous shortcut would bypass both provenance and
 * long-running lifecycle ownership.
 */
export function createWorkspaceResourceReferenceImageOperations(): ProjectAgentOperationRegistryDraft {
  return {}
}
