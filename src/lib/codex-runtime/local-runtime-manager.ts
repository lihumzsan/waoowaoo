import path from 'node:path'
import { CodexAppServerClient, type CodexAppServerClientOptions } from './app-server-client'
import type { RuntimeAdapter, RuntimeClientInfo, RuntimeInitializeCapabilities } from './runtime-adapter'

type RuntimeEntry = {
  readonly cwd: string
  readonly client: CodexAppServerClient
  readonly ready: Promise<CodexAppServerClient>
}

export type LocalRuntimeManagerOptions = {
  readonly clientInfo: RuntimeClientInfo
  readonly initializeCapabilities?: RuntimeInitializeCapabilities | null
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: NodeJS.ProcessEnv
  readonly shutdownTimeoutMs?: number
}

export type EnsureLocalRuntimeParams = {
  readonly runtimeKey: string
  readonly cwd: string
}

function requireRuntimeKey(value: string): string {
  const key = value.trim()
  if (!key) throw new Error('CODEX_RUNTIME_KEY_REQUIRED')
  return key
}

function requireAbsoluteCwd(value: string): string {
  const cwd = value.trim()
  if (!cwd || !path.isAbsolute(cwd)) throw new Error('CODEX_RUNTIME_CWD_ABSOLUTE_REQUIRED')
  return path.normalize(cwd)
}

export class LocalRuntimeManager {
  private readonly options: LocalRuntimeManagerOptions
  private readonly entries = new Map<string, RuntimeEntry>()
  private shuttingDown = false

  constructor(options: LocalRuntimeManagerOptions) {
    this.options = options
  }

  async ensure(params: EnsureLocalRuntimeParams): Promise<RuntimeAdapter> {
    if (this.shuttingDown) throw new Error('CODEX_RUNTIME_MANAGER_SHUTTING_DOWN')
    const runtimeKey = requireRuntimeKey(params.runtimeKey)
    const cwd = requireAbsoluteCwd(params.cwd)
    const existing = this.entries.get(runtimeKey)
    if (existing) {
      if (existing.cwd !== cwd) throw new Error('CODEX_RUNTIME_KEY_CWD_MISMATCH')
      return await existing.ready
    }

    const client = new CodexAppServerClient(this.createClientOptions(cwd))
    const ready = client.initialize().then(() => client)
    const entry: RuntimeEntry = { cwd, client, ready }
    this.entries.set(runtimeKey, entry)
    const unsubscribe = client.subscribe((event) => {
      if (event.type !== 'processExited') return
      unsubscribe()
      if (this.entries.get(runtimeKey) === entry) this.entries.delete(runtimeKey)
    })

    try {
      return await ready
    } catch (error) {
      unsubscribe()
      if (this.entries.get(runtimeKey) === entry) this.entries.delete(runtimeKey)
      await client.shutdown().catch(() => undefined)
      throw error
    }
  }

  async shutdown(runtimeKeyValue: string): Promise<void> {
    const runtimeKey = requireRuntimeKey(runtimeKeyValue)
    const entry = this.entries.get(runtimeKey)
    if (!entry) return
    this.entries.delete(runtimeKey)
    await entry.client.shutdown()
  }

  async forceShutdown(runtimeKeyValue: string): Promise<void> {
    const runtimeKey = requireRuntimeKey(runtimeKeyValue)
    const entry = this.entries.get(runtimeKey)
    if (!entry) return
    this.entries.delete(runtimeKey)
    await entry.client.forceShutdown()
  }

  async shutdownAll(): Promise<void> {
    this.shuttingDown = true
    const entries = [...this.entries.values()]
    this.entries.clear()
    const results = await Promise.allSettled(
      entries.map(async (entry) => await entry.client.shutdown()),
    )
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (failures.length > 0) throw new AggregateError(failures, 'CODEX_RUNTIME_MANAGER_SHUTDOWN_FAILED')
  }

  private createClientOptions(cwd: string): CodexAppServerClientOptions {
    return {
      cwd,
      clientInfo: this.options.clientInfo,
      initializeCapabilities: this.options.initializeCapabilities,
      command: this.options.command,
      args: this.options.args,
      env: this.options.env,
      shutdownTimeoutMs: this.options.shutdownTimeoutMs,
    }
  }
}
