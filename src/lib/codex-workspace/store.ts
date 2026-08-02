import {
  initializeWorkspaceBundle,
  loadWorkspaceBundle,
  saveWorkspaceBundle,
  type WorkspaceBundleSaveResult,
  type WorkspaceBundleStoreView,
  type WorkspaceStoreScope,
} from '@/lib/codex-runtime/workspace-store'
import type { WorkspaceBundleV1 } from '@/lib/codex-runtime/workspace-bundle'
import {
  type CodexAuthoringWriteback,
} from './contracts'
import { requireCodexAuthoringBundle } from './authoring'

/** The Runtime Manager should use this instead of the low-level bundle store. */
export async function loadCodexAuthoringBundle(
  scope: WorkspaceStoreScope,
): Promise<WorkspaceBundleStoreView> {
  const stored = await loadWorkspaceBundle(scope)
  return { ...stored, bundle: requireCodexAuthoringBundle(stored.bundle) }
}

export async function initializeCodexAuthoringBundle(
  scope: WorkspaceStoreScope,
  initialBundle: WorkspaceBundleV1 = { schemaVersion: 1, files: [] },
): Promise<WorkspaceBundleStoreView> {
  return await initializeWorkspaceBundle(scope, requireCodexAuthoringBundle(initialBundle))
}

export async function saveCodexAuthoringWriteback(
  scope: WorkspaceStoreScope,
  writeback: CodexAuthoringWriteback,
): Promise<WorkspaceBundleSaveResult> {
  return await saveWorkspaceBundle(scope, requireCodexAuthoringBundle(writeback.authoringBundle))
}
