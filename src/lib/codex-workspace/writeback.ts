import {
  validateWorkspaceBundle,
  WORKSPACE_BUNDLE_SCHEMA_VERSION,
  type WorkspaceBundleFile,
  type WorkspaceBundleV1,
} from '@/lib/codex-runtime/workspace-bundle'
import {
  CODEX_WORKSPACE_AUTHORING_PREFIX,
  CODEX_WORKSPACE_SYSTEM_PREFIX,
  CodexWorkspaceError,
  type CodexAuthoringChange,
  type CodexAuthoringWriteback,
} from './contracts'

function fileMap(files: readonly WorkspaceBundleFile[]): Map<string, string> {
  return new Map(files.map((file) => [file.path, file.content]))
}

function requireRuntimePaths(bundle: WorkspaceBundleV1): WorkspaceBundleV1 {
  const normalized = validateWorkspaceBundle(bundle)
  const invalid = normalized.files.find((file) => (
    !file.path.startsWith(CODEX_WORKSPACE_AUTHORING_PREFIX)
    && !file.path.startsWith(CODEX_WORKSPACE_SYSTEM_PREFIX)
  ))
  if (invalid) {
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_RUNTIME_PATH_INVALID',
      `Runtime workspace file is outside the system and authoring roots: ${invalid.path}`,
    )
  }
  return normalized
}

function assertProtectedProjectionUnchanged(
  baseline: WorkspaceBundleV1,
  captured: WorkspaceBundleV1,
): void {
  const baselineSystem = fileMap(
    baseline.files.filter((file) => file.path.startsWith(CODEX_WORKSPACE_SYSTEM_PREFIX)),
  )
  const capturedSystem = fileMap(
    captured.files.filter((file) => file.path.startsWith(CODEX_WORKSPACE_SYSTEM_PREFIX)),
  )
  const allPaths = new Set([...baselineSystem.keys(), ...capturedSystem.keys()])
  for (const protectedPath of allPaths) {
    if (baselineSystem.get(protectedPath) !== capturedSystem.get(protectedPath)) {
      throw new CodexWorkspaceError(
        'CODEX_WORKSPACE_PROTECTED_FILE_CHANGED',
        `Projected system file cannot be created, changed, or deleted: ${protectedPath}`,
      )
    }
  }
}

function projectChanges(
  baselineFiles: readonly WorkspaceBundleFile[],
  nextFiles: readonly WorkspaceBundleFile[],
): CodexAuthoringChange[] {
  const baseline = fileMap(baselineFiles)
  const next = fileMap(nextFiles)
  const paths = [...new Set([...baseline.keys(), ...next.keys()])].sort()
  return paths.flatMap((path): CodexAuthoringChange[] => {
    const before = baseline.get(path)
    const after = next.get(path)
    if (before === after) return []
    if (before === undefined) return [{ kind: 'created', path }]
    if (after === undefined) return [{ kind: 'deleted', path }]
    return [{ kind: 'updated', path }]
  })
}

/**
 * Drops every DB-derived system projection and returns only explicit files in
 * authoring/**. Task, Artifact, Resource lifecycle, URLs and Canvas state can
 * never be written back through this boundary.
 */
export function extractCodexAuthoringWriteback(input: {
  readonly baselineRuntimeBundle: WorkspaceBundleV1
  readonly capturedRuntimeBundle: WorkspaceBundleV1
}): CodexAuthoringWriteback {
  const baseline = requireRuntimePaths(input.baselineRuntimeBundle)
  const captured = requireRuntimePaths(input.capturedRuntimeBundle)
  assertProtectedProjectionUnchanged(baseline, captured)

  const baselineAuthoring = baseline.files.filter((file) => (
    file.path.startsWith(CODEX_WORKSPACE_AUTHORING_PREFIX)
  ))
  const nextAuthoring = captured.files.filter((file) => (
    file.path.startsWith(CODEX_WORKSPACE_AUTHORING_PREFIX)
  ))
  return {
    authoringBundle: validateWorkspaceBundle({
      schemaVersion: WORKSPACE_BUNDLE_SCHEMA_VERSION,
      files: nextAuthoring,
    }),
    changes: projectChanges(baselineAuthoring, nextAuthoring),
  }
}
