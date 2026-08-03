import path from 'node:path'
import { CodexAppServerClient, type CodexAppServerClientOptions } from './app-server-client'
import { normalizeRuntimeScopedEnvironment } from './runtime-container'
import type {
  RuntimeContainerAdapter,
  RuntimeContainerHandle,
  RuntimeContainerLaunchRequest,
} from './runtime-container'

export type LocalProcessRuntimeContainerOptions = Omit<CodexAppServerClientOptions, 'cwd' | 'env'>

const SAFE_LOCAL_ENVIRONMENT_NAMES = [
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_EXTRA_CA_CERTS',
  'NO_PROXY',
  'PATH',
  'SHELL',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TERM',
  'TMPDIR',
  'TZ',
] as const

/**
 * Development and trusted single-tenant adapter only. Deployment policy must
 * explicitly select it; production code must never fall back to it.
 */
export class LocalProcessRuntimeContainerAdapter implements RuntimeContainerAdapter {
  private readonly options: LocalProcessRuntimeContainerOptions

  constructor(options: LocalProcessRuntimeContainerOptions) {
    this.options = options
  }

  async reconcile(scopeId: string): Promise<void> {
    // A local child process is owned by the current manager process. There is
    // no cross-process placement authority in this development-only adapter.
    void scopeId
  }

  async launch(request: RuntimeContainerLaunchRequest): Promise<RuntimeContainerHandle> {
    const workspaceDirectory = requireAbsolutePath(
      request.materialization.hostWorkspaceDirectory,
      'CODEX_LOCAL_RUNTIME_WORKSPACE_INVALID',
    )
    const codexHomeDirectory = requireAbsolutePath(
      request.materialization.hostCodexHomeDirectory,
      'CODEX_LOCAL_RUNTIME_HOME_INVALID',
    )
    const env = Object.create(null) as NodeJS.ProcessEnv
    for (const name of SAFE_LOCAL_ENVIRONMENT_NAMES) {
      const value = process.env[name]
      if (value !== undefined) env[name] = value
    }
    env.CODEX_HOME = codexHomeDirectory
    Object.assign(env, normalizeRuntimeScopedEnvironment(request.environment))
    const runtime = new CodexAppServerClient({
      ...this.options,
      cwd: workspaceDirectory,
      env,
    })

    return {
      runtime,
      runtimeWorkspaceDirectory: workspaceDirectory,
      identity: `local:${request.scopeId}`,
      stop: async (mode) => {
        if (mode === 'force') return await runtime.forceShutdown()
        await runtime.shutdown()
      },
    }
  }
}

function requireAbsolutePath(value: string, code: string): string {
  const normalized = path.normalize(value.trim())
  if (!path.isAbsolute(normalized)) throw new Error(code)
  return normalized
}
