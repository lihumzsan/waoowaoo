import {
  createRuntimeContainerAdapter,
  readCodexRuntimeConfig,
} from '@/lib/codex-runtime/runtime-config'
import {
  RuntimeSessionManager,
  type RuntimeSessionScope,
} from '@/lib/codex-runtime/runtime-session-manager'
import { createScopedLogger } from '@/lib/logging/core'
import {
  issueAssistantRuntimeAccess,
  resolveAssistantRuntimeModelConfiguration,
  type AssistantRuntimeAccess,
} from './runtime-access'
import { RedisAssistantRuntimeOwnership } from './runtime-ownership'
import { AssistantRuntimePersistence } from './runtime-persistence'
import {
  AssistantRuntimeService,
  type AssistantRuntimeAccessProvider,
} from './service'

const logger = createScopedLogger({ module: 'assistant-runtime.singleton' })
const ACCESS_MIN_REMAINING_MS = 60_000

function scopeKey(scope: RuntimeSessionScope): string {
  return `${scope.userId.length}:${scope.userId}${scope.projectId.length}:${scope.projectId}`
}

class ProjectRuntimeAccessProvider implements AssistantRuntimeAccessProvider {
  private readonly manager: RuntimeSessionManager
  private readonly values = new Map<string, AssistantRuntimeAccess>()
  private readonly rotations = new Map<string, Promise<AssistantRuntimeAccess>>()

  constructor(manager: RuntimeSessionManager) {
    this.manager = manager
  }

  async get(scope: RuntimeSessionScope): Promise<AssistantRuntimeAccess> {
    const key = scopeKey(scope)
    const existing = this.values.get(key)
    if (existing && existing.expiresAtMs - Date.now() > ACCESS_MIN_REMAINING_MS) return existing
    const rotating = this.rotations.get(key)
    if (rotating) return await rotating
    const next = this.rotate(scope, key, existing !== undefined)
    this.rotations.set(key, next)
    try {
      return await next
    } finally {
      if (this.rotations.get(key) === next) this.rotations.delete(key)
    }
  }

  invalidate(scope: RuntimeSessionScope): void {
    this.values.delete(scopeKey(scope))
  }

  private async rotate(
    scope: RuntimeSessionScope,
    key: string,
    stopExisting: boolean,
  ): Promise<AssistantRuntimeAccess> {
    if (stopExisting) await this.manager.stop(scope, 'shutdown')
    const issued = issueAssistantRuntimeAccess(scope)
    this.values.set(key, issued)
    return issued
  }
}

type AssistantRuntimeProcessState = typeof globalThis & {
  __waoAssistantRuntimeService?: AssistantRuntimeService | null
}

function processState(): AssistantRuntimeProcessState {
  return globalThis as AssistantRuntimeProcessState
}

export function getAssistantRuntimeService(): AssistantRuntimeService {
  const state = processState()
  if (state.__waoAssistantRuntimeService) return state.__waoAssistantRuntimeService
  const config = readCodexRuntimeConfig()
  let service: AssistantRuntimeService | null = null
  const manager = new RuntimeSessionManager({
    container: createRuntimeContainerAdapter(config, {
      clientInfo: {
        name: 'waoowaoo',
        title: 'Wao Creative Runtime',
        version: process.env.npm_package_version?.trim() || 'development',
      },
    }),
    persistence: new AssistantRuntimePersistence({ hostRoot: config.hostRoot }),
    ownership: new RedisAssistantRuntimeOwnership(),
    idleTimeoutMs: config.idleTimeoutMs,
    waitForTurnSettlement: async (scope) => {
      await service?.waitForTurnSettlements(scope)
    },
    onError: ({ scope, phase, error }) => {
      logger.error({
        action: 'assistant_runtime.manager_error',
        message: 'assistant runtime manager error',
        projectId: scope.projectId,
        userId: scope.userId,
        details: { phase, error: error.message },
      })
    },
  })
  service = new AssistantRuntimeService({
    manager,
    access: new ProjectRuntimeAccessProvider(manager),
    models: {
      resolve: resolveAssistantRuntimeModelConfiguration,
    },
  })
  state.__waoAssistantRuntimeService = service
  return service
}

export async function shutdownAssistantRuntimeService(): Promise<void> {
  const state = processState()
  const current = state.__waoAssistantRuntimeService ?? null
  state.__waoAssistantRuntimeService = null
  if (current) await current.shutdown()
}

export async function submitAssistantRuntimeTaskFollowUp(batchId: string) {
  return await getAssistantRuntimeService().submitTaskFollowUp(batchId)
}
