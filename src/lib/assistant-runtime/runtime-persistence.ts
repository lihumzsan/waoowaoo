import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  captureWorkspaceBundle,
  encodeWorkspaceBundle,
  materializeWorkspaceBundle,
} from '@/lib/codex-runtime/workspace-bundle'
import type { WorkspaceBundleV1 } from '@/lib/codex-runtime/workspace-bundle'
import type {
  RuntimeSessionMaterialization,
  RuntimeSessionPersistence,
  RuntimeSessionScope,
} from '@/lib/codex-runtime/runtime-session-manager'
import {
  captureCodexWorkspace,
  readCodexRuntimeWorkspace,
  type CodexWorkspaceBaseline,
  type CodexWorkspaceDirectoryIdentity,
} from '@/lib/codex-workspace'
import { prisma } from '@/lib/prisma'
import { publishWorkspaceResourceChanges } from '@/lib/workspace-resource/resource-change-publisher'
import { captureCodexStateBundle, restoreCodexStateBundle, saveCodexStateBundle } from './codex-state-store'
import { markAssistantRuntimeProjectTurnsInterrupted } from './persistence'
import { materializeCreativeRuntimeConfiguration } from '@/lib/creative-skills'

const MATERIALIZATION_PREFIX = 'wao-codex-runtime-'
const BASELINE_FILE_NAME = 'workspace-baseline.bundle.json'

type MaterializationLayout = {
  readonly root: string
  readonly workspace: string
  readonly codexHome: string
  readonly baseline: string
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
      await materializeCreativeRuntimeConfiguration(codexHome)
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
    if (writeback.changes.length > 0) {
      await publishWorkspaceResourceChanges({
        projectId: params.scope.projectId,
        userId: params.scope.userId,
        affectedResources: [{ kind: 'workspaceResources', projectId: params.scope.projectId }],
      })
    }
  }

  async refreshWorkspace(params: Parameters<RuntimeSessionPersistence['refreshWorkspace']>[0]): Promise<void> {
    const layout = layoutFromMaterialization(params.materialization, this.hostRoot)
    const [baselineText, captured] = await Promise.all([
      readFile(layout.baseline, 'utf8'),
      captureWorkspaceBundle(layout.workspace),
    ])
    const baseline = parseRuntimeBaseline(baselineText)
    if (!encodeWorkspaceBundle(captured).equals(encodeWorkspaceBundle(baseline.runtimeBundle))) {
      throw new Error('ASSISTANT_RUNTIME_WORKSPACE_CHANGED_DURING_MCP')
    }
    const projection = await readCodexRuntimeWorkspace({
      projectId: params.scope.projectId,
      userId: params.scope.userId,
    })
    await synchronizeRuntimeWorkspace(layout.workspace, captured, projection.runtimeBundle)
    const directoryIdentities = await readDirectoryIdentities(
      layout.workspace,
      projection.runtimeBundle.directories,
    )
    await writeRuntimeBaseline(layout.baseline, {
      runtimeBundle: projection.runtimeBundle,
      baseline: hydrateFolderRuntimeIdentities(projection.baseline, directoryIdentities),
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

  async destroyMaterialization(materialization: RuntimeSessionMaterialization): Promise<void> {
    const layout = layoutFromMaterialization(materialization, this.hostRoot)
    await rm(layout.root, { recursive: true, force: true })
  }
}

/** Diagnostic-only helper for validating the strict Codex-home allowlist. */
export async function inspectCapturedCodexState(codexHomeDirectory: string): Promise<number> {
  return (await captureCodexStateBundle(codexHomeDirectory)).byteLength
}
