import type { RuntimeAdapter } from './runtime-adapter'

export type RuntimeContainerMaterialization = {
  readonly hostWorkspaceDirectory: string
  readonly hostCodexHomeDirectory: string
}

export type RuntimeContainerLaunchRequest = {
  readonly scopeId: string
  readonly ownerToken: string
  readonly materialization: RuntimeContainerMaterialization
  readonly environment: Readonly<Record<string, string>>
}

export interface RuntimeContainerHandle {
  readonly runtime: RuntimeAdapter
  readonly runtimeWorkspaceDirectory: string
  readonly identity: string

  stop(mode: 'graceful' | 'force'): Promise<void>
}

export interface RuntimeContainerAdapter {
  /** Kill every stale runtime carrying this canonical scope label before placement. */
  reconcile(scopeId: string): Promise<void>
  launch(request: RuntimeContainerLaunchRequest): Promise<RuntimeContainerHandle>
}

export function normalizeRuntimeScopedEnvironment(
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const entries = Object.entries(environment).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) throw new Error('CODEX_RUNTIME_SCOPED_ENVIRONMENT_REQUIRED')
  let totalBytes = 0
  const normalized: Record<string, string> = {}
  for (const [name, value] of entries) {
    if (!/^WAO_MCP_[A-Z0-9_]+$/u.test(name)) {
      throw new Error('CODEX_RUNTIME_SCOPED_ENVIRONMENT_NAME_INVALID')
    }
    if (!value || value.includes('\0')) {
      throw new Error('CODEX_RUNTIME_SCOPED_ENVIRONMENT_VALUE_INVALID')
    }
    totalBytes += Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8')
    if (totalBytes > 32 * 1024) throw new Error('CODEX_RUNTIME_SCOPED_ENVIRONMENT_TOO_LARGE')
    normalized[name] = value
  }
  return Object.freeze(normalized)
}
