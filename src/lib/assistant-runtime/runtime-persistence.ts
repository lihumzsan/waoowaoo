import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  captureWorkspaceBundle,
  encodeWorkspaceBundle,
  materializeWorkspaceBundle,
  parseWorkspaceBundle,
} from '@/lib/codex-runtime/workspace-bundle'
import type {
  RuntimeSessionMaterialization,
  RuntimeSessionOwnership,
  RuntimeSessionOwnershipClaim,
  RuntimeSessionPersistence,
  RuntimeSessionScope,
} from '@/lib/codex-runtime/runtime-session-manager'
import {
  extractCodexAuthoringWriteback,
  initializeCodexAuthoringBundle,
  loadCodexAuthoringBundle,
  readCodexRuntimeWorkspace,
  saveCodexAuthoringWriteback,
} from '@/lib/codex-workspace'
import { WorkspaceStoreError } from '@/lib/codex-runtime/workspace-store'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { captureCodexStateBundle, restoreCodexStateBundle, saveCodexStateBundle } from './codex-state-store'
import { markAssistantRuntimeProjectTurnsInterrupted } from './persistence'

const MATERIALIZATION_PREFIX = 'wao-codex-runtime-'
const BASELINE_FILE_NAME = 'workspace-baseline.bundle.json'
const OWNERSHIP_LEASE_MS = 45_000
const OWNERSHIP_RENEW_MS = 15_000

type MaterializationLayout = {
  readonly root: string
  readonly workspace: string
  readonly codexHome: string
  readonly baseline: string
}

function requireIdentity(value: string, code: string): string {
  if (value !== value.trim() || !/^[A-Za-z0-9_-]{1,191}$/u.test(value)) throw new Error(code)
  return value
}

function scopeHash(scope: RuntimeSessionScope): string {
  const hash = createHash('sha256')
  for (const value of [
    requireIdentity(scope.userId, 'ASSISTANT_RUNTIME_SCOPE_USER_INVALID'),
    requireIdentity(scope.projectId, 'ASSISTANT_RUNTIME_SCOPE_PROJECT_INVALID'),
  ]) {
    const bytes = Buffer.from(value, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(bytes.length)
    hash.update(length)
    hash.update(bytes)
  }
  return hash.digest('hex')
}

function requireHostRoot(value: string): string {
  const normalized = path.resolve(value.trim())
  if (!value || !path.isAbsolute(value) || normalized === path.parse(normalized).root) {
    throw new Error('ASSISTANT_RUNTIME_HOST_ROOT_INVALID')
  }
  return normalized
}

function layoutFromMaterialization(
  materialization: RuntimeSessionMaterialization,
  hostRoot: string,
): MaterializationLayout {
  const workspace = path.resolve(materialization.hostWorkspaceDirectory)
  const codexHome = path.resolve(materialization.hostCodexHomeDirectory)
  const root = path.dirname(workspace)
  if (
    path.basename(workspace) !== 'workspace'
    || path.basename(codexHome) !== 'codex-home'
    || path.dirname(codexHome) !== root
    || path.dirname(root) !== hostRoot
    || !path.basename(root).startsWith(MATERIALIZATION_PREFIX)
  ) {
    throw new Error('ASSISTANT_RUNTIME_MATERIALIZATION_LAYOUT_INVALID')
  }
  return { root, workspace, codexHome, baseline: path.join(root, BASELINE_FILE_NAME) }
}

async function loadOrInitializeAuthoring(scope: RuntimeSessionScope) {
  try {
    return await loadCodexAuthoringBundle(scope)
  } catch (error) {
    if (!(error instanceof WorkspaceStoreError) || error.code !== 'WORKSPACE_NOT_INITIALIZED') {
      throw error
    }
    return await initializeCodexAuthoringBundle(scope)
  }
}

async function checkpointRuntimeThreadBinding(input: {
  readonly scope: RuntimeSessionScope
  readonly productThreadId: string
  readonly runtimeThreadId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const thread = await tx.projectAssistantThread.findUnique({
      where: { id: input.productThreadId },
    })
    if (
      !thread
      || thread.projectId !== input.scope.projectId
      || thread.userId !== input.scope.userId
      || thread.assistantId !== 'workspace-command'
    ) {
      throw new Error('ASSISTANT_RUNTIME_CHECKPOINT_THREAD_SCOPE_DIVERGED')
    }
    if (thread.runtimeThreadId && thread.runtimeThreadId !== input.runtimeThreadId) {
      throw new Error('ASSISTANT_RUNTIME_CHECKPOINT_THREAD_ID_DIVERGED')
    }
    if (!thread.runtimeThreadId) {
      await tx.projectAssistantThread.update({
        where: { id: thread.id },
        data: { runtimeThreadId: input.runtimeThreadId },
      })
    }
  })
}

export class AssistantRuntimePersistence implements RuntimeSessionPersistence {
  private readonly hostRoot: string

  constructor(input: { readonly hostRoot: string }) {
    this.hostRoot = requireHostRoot(input.hostRoot)
  }

  async reconcileBeforeStart(scope: RuntimeSessionScope): Promise<void> {
    await markAssistantRuntimeProjectTurnsInterrupted({
      scope,
      runtimeThreadId: null,
      runtimeTurnId: null,
      reason: 'runtime_reconciled_before_start',
    })
  }

  async materialize(scope: RuntimeSessionScope): Promise<RuntimeSessionMaterialization> {
    await mkdir(this.hostRoot, { recursive: true, mode: 0o700 })
    const root = await mkdtemp(path.join(this.hostRoot, MATERIALIZATION_PREFIX))
    const workspace = path.join(root, 'workspace')
    const codexHome = path.join(root, 'codex-home')
    try {
      const authoring = await loadOrInitializeAuthoring(scope)
      const projection = await readCodexRuntimeWorkspace({
        projectId: scope.projectId,
        userId: scope.userId,
        episodeId: null,
        authoringBundle: authoring.bundle,
      })
      await materializeWorkspaceBundle(workspace, projection.runtimeBundle)
      await restoreCodexStateBundle({ scope, codexHomeDirectory: codexHome })
      await writeFile(
        path.join(root, BASELINE_FILE_NAME),
        encodeWorkspaceBundle(projection.runtimeBundle),
        { flag: 'wx', mode: 0o600 },
      )
      return {
        hostWorkspaceDirectory: workspace,
        hostCodexHomeDirectory: codexHome,
      }
    } catch (error) {
      await rm(root, { recursive: true, force: true })
      throw error
    }
  }

  async captureWorkspace(params: Parameters<RuntimeSessionPersistence['captureWorkspace']>[0]): Promise<void> {
    const layout = layoutFromMaterialization(params.materialization, this.hostRoot)
    const [baselineBytes, captured] = await Promise.all([
      readFile(layout.baseline),
      captureWorkspaceBundle(layout.workspace),
    ])
    const writeback = extractCodexAuthoringWriteback({
      baselineRuntimeBundle: parseWorkspaceBundle(baselineBytes),
      capturedRuntimeBundle: captured,
    })
    await saveCodexAuthoringWriteback(params.scope, writeback)
  }

  async checkpointRuntime(params: Parameters<RuntimeSessionPersistence['checkpointRuntime']>[0]): Promise<void> {
    const layout = layoutFromMaterialization(params.materialization, this.hostRoot)
    await saveCodexStateBundle({
      scope: params.scope,
      codexHomeDirectory: layout.codexHome,
    })
    await checkpointRuntimeThreadBinding(params)
  }

  async recordInterrupted(params: Parameters<RuntimeSessionPersistence['recordInterrupted']>[0]): Promise<void> {
    await markAssistantRuntimeProjectTurnsInterrupted({
      scope: params.scope,
      runtimeThreadId: params.runtimeThreadId,
      runtimeTurnId: params.runtimeTurnId,
      reason: params.reason,
    })
  }

  async destroyMaterialization(materialization: RuntimeSessionMaterialization): Promise<void> {
    const layout = layoutFromMaterialization(materialization, this.hostRoot)
    await rm(layout.root, { recursive: true, force: true })
  }
}

const OWNERSHIP_RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`

const OWNERSHIP_RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

export class RedisAssistantRuntimeOwnership implements RuntimeSessionOwnership {
  async acquire(scope: RuntimeSessionScope): Promise<RuntimeSessionOwnershipClaim> {
    const key = `assistant-runtime:owner:v1:${scopeHash(scope)}`
    const ownerToken = randomUUID()
    const acquired = await redis.set(key, ownerToken, 'PX', OWNERSHIP_LEASE_MS, 'NX')
    if (acquired !== 'OK') throw new Error('ASSISTANT_RUNTIME_OWNERSHIP_BUSY')
    let active = true
    let timer: NodeJS.Timeout | null = null
    let resolveLost: (() => void) | null = null
    const lost = new Promise<void>((resolve) => {
      resolveLost = resolve
    })
    const schedule = (): void => {
      if (!active) return
      timer = setTimeout(() => {
        void redis.eval(
          OWNERSHIP_RENEW_SCRIPT,
          1,
          key,
          ownerToken,
          String(OWNERSHIP_LEASE_MS),
        ).then((result) => {
          if (result !== 1) {
            active = false
            resolveLost?.()
            return
          }
          schedule()
        }).catch(() => {
          active = false
          resolveLost?.()
        })
      }, OWNERSHIP_RENEW_MS)
      timer.unref()
    }
    schedule()
    return {
      ownerToken,
      lost,
      async release() {
        if (!active) return
        active = false
        if (timer) clearTimeout(timer)
        await redis.eval(OWNERSHIP_RELEASE_SCRIPT, 1, key, ownerToken)
      },
    }
  }
}

/** Diagnostic-only helper for validating the strict Codex-home allowlist. */
export async function inspectCapturedCodexState(codexHomeDirectory: string): Promise<number> {
  return (await captureCodexStateBundle(codexHomeDirectory)).byteLength
}
