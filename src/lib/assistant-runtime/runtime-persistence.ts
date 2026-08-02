import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  captureWorkspaceBundle,
  materializeWorkspaceBundle,
} from '@/lib/codex-runtime/workspace-bundle'
import type { WorkspaceBundleV1 } from '@/lib/codex-runtime/workspace-bundle'
import type {
  RuntimeSessionMaterialization,
  RuntimeSessionOwnership,
  RuntimeSessionOwnershipClaim,
  RuntimeSessionPersistence,
  RuntimeSessionScope,
} from '@/lib/codex-runtime/runtime-session-manager'
import {
  captureCodexWorkspace,
  readCodexRuntimeWorkspace,
  type CodexWorkspaceBaseline,
  type CodexWorkspaceDirectoryIdentity,
} from '@/lib/codex-workspace'
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

type RuntimeBaselineFile = {
  readonly runtimeBundle: WorkspaceBundleV1
  readonly baseline: CodexWorkspaceBaseline
}

function parseRuntimeBaseline(value: string): RuntimeBaselineFile {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ASSISTANT_RUNTIME_BASELINE_INVALID')
  }
  const record = parsed as Record<string, unknown>
  if (!record.runtimeBundle || !record.baseline) throw new Error('ASSISTANT_RUNTIME_BASELINE_INVALID')
  return record as RuntimeBaselineFile
}

async function writeRuntimeBaseline(filePath: string, value: RuntimeBaselineFile, exclusive: boolean): Promise<void> {
  const bytes = `${JSON.stringify(value)}\n`
  if (exclusive) {
    await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 })
    return
  }
  const temporary = `${filePath}.${randomUUID()}.tmp`
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
  await rename(temporary, filePath)
}

async function readDirectoryIdentities(
  rootDirectory: string,
  directories: readonly string[],
): Promise<readonly CodexWorkspaceDirectoryIdentity[]> {
  return await Promise.all(directories.map(async (relativePath) => {
    const stats = await lstat(path.join(rootDirectory, ...relativePath.split('/')))
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`ASSISTANT_RUNTIME_DIRECTORY_IDENTITY_INVALID:${relativePath}`)
    }
    return {
      path: relativePath,
      runtimeIdentity: `${String(stats.dev)}:${String(stats.ino)}`,
    }
  }))
}

function hydrateFolderRuntimeIdentities(
  baseline: CodexWorkspaceBaseline,
  identities: readonly CodexWorkspaceDirectoryIdentity[],
): CodexWorkspaceBaseline {
  const identityByPath = new Map(identities.map((entry) => [entry.path, entry.runtimeIdentity]))
  return {
    ...baseline,
    resources: baseline.resources.map((resource) => ({
      ...resource,
      runtimeIdentity: resource.resourceKind === 'folder'
        ? identityByPath.get(resource.workspacePath) ?? null
        : null,
    })),
  }
}

async function synchronizeRuntimeWorkspace(
  directory: string,
  before: WorkspaceBundleV1,
  after: WorkspaceBundleV1,
): Promise<void> {
  const nextPaths = new Set(after.files.map((file) => file.path))
  await Promise.all(before.files
    .filter((file) => !nextPaths.has(file.path))
    .map(async (file) => {
      await unlink(path.join(directory, ...file.path.split('/'))).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    }))
  const nextDirectories = new Set(after.directories)
  const removedDirectories = before.directories
    .filter((directory) => !nextDirectories.has(directory))
    .sort((left, right) => {
      const depth = right.split('/').length - left.split('/').length
      return depth || right.localeCompare(left)
    })
  for (const relativeDirectory of removedDirectories) {
    await rmdir(path.join(directory, ...relativeDirectory.split('/'))).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
  for (const relativeDirectory of after.directories) {
    await mkdir(path.join(directory, ...relativeDirectory.split('/')), { recursive: true, mode: 0o700 })
  }
  for (const file of after.files) {
    const target = path.join(directory, ...file.path.split('/'))
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, file.content, { mode: 0o600 })
  }
}

async function materializeNativeSkills(
  codexHomeDirectory: string,
  runtimeBundle: WorkspaceBundleV1,
): Promise<void> {
  const prefix = 'system/skills/'
  for (const file of runtimeBundle.files.filter((entry) => entry.path.startsWith(prefix))) {
    const relative = file.path.slice(prefix.length)
    if (!/^[A-Za-z0-9_-]+\/SKILL\.md$/u.test(relative)) {
      throw new Error(`ASSISTANT_RUNTIME_SKILL_PATH_INVALID:${file.path}`)
    }
    const target = path.join(codexHomeDirectory, 'skills', ...relative.split('/'))
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, file.content, { mode: 0o600 })
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
      const projection = await readCodexRuntimeWorkspace({
        projectId: scope.projectId,
        userId: scope.userId,
      })
      await materializeWorkspaceBundle(workspace, projection.runtimeBundle)
      await restoreCodexStateBundle({ scope, codexHomeDirectory: codexHome })
      await materializeNativeSkills(codexHome, projection.runtimeBundle)
      const directoryIdentities = await readDirectoryIdentities(
        workspace,
        projection.runtimeBundle.directories,
      )
      await writeRuntimeBaseline(path.join(root, BASELINE_FILE_NAME), {
        runtimeBundle: projection.runtimeBundle,
        baseline: hydrateFolderRuntimeIdentities(projection.baseline, directoryIdentities),
      }, true)
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
    const [baselineText, captured] = await Promise.all([
      readFile(layout.baseline, 'utf8'),
      captureWorkspaceBundle(layout.workspace),
    ])
    const capturedDirectoryIdentities = await readDirectoryIdentities(
      layout.workspace,
      captured.directories,
    )
    const baseline = parseRuntimeBaseline(baselineText)
    const writeback = await captureCodexWorkspace({
      userId: params.scope.userId,
      projectId: params.scope.projectId,
      baselineRuntimeBundle: baseline.runtimeBundle,
      baseline: baseline.baseline,
      capturedRuntimeBundle: captured,
      capturedDirectoryIdentities,
    })
    await synchronizeRuntimeWorkspace(layout.workspace, captured, writeback.runtimeBundle)
    const refreshedDirectoryIdentities = await readDirectoryIdentities(
      layout.workspace,
      writeback.runtimeBundle.directories,
    )
    await writeRuntimeBaseline(layout.baseline, {
      runtimeBundle: writeback.runtimeBundle,
      baseline: hydrateFolderRuntimeIdentities(writeback.baseline, refreshedDirectoryIdentities),
    }, false)
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
