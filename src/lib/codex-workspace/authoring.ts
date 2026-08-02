import {
  validateWorkspaceBundle,
  type WorkspaceBundleV1,
} from '@/lib/codex-runtime/workspace-bundle'
import {
  CODEX_WORKSPACE_AUTHORING_PREFIX,
  CodexWorkspaceError,
} from './contracts'

export function requireCodexAuthoringBundle(bundle: WorkspaceBundleV1): WorkspaceBundleV1 {
  const normalized = validateWorkspaceBundle(bundle)
  const invalid = normalized.files.find((file) => (
    !file.path.startsWith(CODEX_WORKSPACE_AUTHORING_PREFIX)
  ))
  if (invalid) {
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_AUTHORING_PATH_REQUIRED',
      `Only explicit authoring files may be persisted: ${invalid.path}`,
    )
  }
  return normalized
}
