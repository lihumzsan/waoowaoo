import { chmod, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  buildRuntimeSessionScopeId,
  type RuntimeSessionMaterialization,
  type RuntimeSessionPersistence,
  type RuntimeSessionScope,
} from '@/lib/codex-runtime/runtime-session-manager'
import { materializeCreativeRuntimeConfiguration } from '@/lib/creative-skills'
import {
  readAssistantRuntimeContractSnapshot,
  requireAdmittedAssistantRuntimeContractSnapshot,
} from './runtime-contract'
import { markAssistantRuntimeProjectTurnsInterrupted } from './persistence'

const MATERIALIZATION_DIRECTORY = 'materializations'
const MATERIALIZATION_PREFIX = 'wao-codex-runtime-'
const CODEX_HOME_DIRECTORY = 'codex-homes'

function requireHostRoot(value: string): string {
  const normalized = path.resolve(value.trim())
  if (!value || !path.isAbsolute(value) || normalized === path.parse(normalized).root) {
    throw new Error('ASSISTANT_RUNTIME_HOST_ROOT_INVALID')
  }
  return normalized
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('ASSISTANT_RUNTIME_PERSISTENCE_DIRECTORY_INVALID')
  }
  await chmod(directory, 0o700)
}

function requireDisposableRoot(
  materialization: RuntimeSessionMaterialization,
  hostRoot: string,
): string {
  const workspace = path.resolve(materialization.hostWorkspaceDirectory)
  const disposableRoot = path.dirname(workspace)
  const materializationsRoot = path.join(hostRoot, MATERIALIZATION_DIRECTORY)
  if (
    path.basename(workspace) !== 'workspace'
    || path.dirname(disposableRoot) !== materializationsRoot
    || !path.basename(disposableRoot).startsWith(MATERIALIZATION_PREFIX)
  ) {
    throw new Error('ASSISTANT_RUNTIME_MATERIALIZATION_LAYOUT_INVALID')
  }
  return disposableRoot
}

export class AssistantRuntimePersistence implements RuntimeSessionPersistence {
  private readonly hostRoot: string
  private readonly scopedCodexHome: boolean

  constructor(input: { readonly hostRoot: string; readonly scopedCodexHome: boolean }) {
    this.hostRoot = requireHostRoot(input.hostRoot)
    this.scopedCodexHome = input.scopedCodexHome
  }

  async readContractRevision(): Promise<string> {
    return (await readAssistantRuntimeContractSnapshot()).revision
  }

  async reconcileBeforeStart(scope: RuntimeSessionScope): Promise<void> {
    await markAssistantRuntimeProjectTurnsInterrupted({
      scope,
      runtimeThreadId: null,
      runtimeTurnId: null,
      reason: 'runtime_reconciled_before_start',
    })
  }

  async materialize(
    scope: RuntimeSessionScope,
    expectedContractRevision: string,
  ): Promise<RuntimeSessionMaterialization> {
    const contract = requireAdmittedAssistantRuntimeContractSnapshot(expectedContractRevision)
    const materializationsRoot = path.join(this.hostRoot, MATERIALIZATION_DIRECTORY)
    const codexHomesRoot = path.join(this.hostRoot, CODEX_HOME_DIRECTORY)
    await ensurePrivateDirectory(this.hostRoot)
    await ensurePrivateDirectory(materializationsRoot)
    if (this.scopedCodexHome) await ensurePrivateDirectory(codexHomesRoot)

    const disposableRoot = await mkdtemp(path.join(materializationsRoot, MATERIALIZATION_PREFIX))
    const workspace = path.join(disposableRoot, 'workspace')
    try {
      await ensurePrivateDirectory(workspace)
      await materializeCreativeRuntimeConfiguration(
        path.join(workspace, '.agents', 'skills'),
        contract.runtimeSkills,
      )
      const codexHome = this.scopedCodexHome
        ? path.join(codexHomesRoot, buildRuntimeSessionScopeId(scope))
        : undefined
      if (codexHome) await ensurePrivateDirectory(codexHome)
      return {
        hostWorkspaceDirectory: workspace,
        contractRevision: contract.revision,
        ...(codexHome ? { hostCodexHomeDirectory: codexHome } : {}),
      }
    } catch (error) {
      await rm(disposableRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      throw error
    }
  }

  async destroyMaterialization(materialization: RuntimeSessionMaterialization): Promise<void> {
    const disposableRoot = requireDisposableRoot(materialization, this.hostRoot)
    await rm(disposableRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }

  async clearScope(scope: RuntimeSessionScope): Promise<void> {
    // Session Manager keeps one explicit clear lifecycle call. Native Codex
    // owns the shared user Home, so Wao must never inspect or mutate it.
    if (!this.scopedCodexHome) return
    const codexHomesRoot = path.join(this.hostRoot, CODEX_HOME_DIRECTORY)
    await ensurePrivateDirectory(this.hostRoot)
    await ensurePrivateDirectory(codexHomesRoot)
    const codexHome = path.join(codexHomesRoot, buildRuntimeSessionScopeId(scope))
    const stat = await lstat(codexHome).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (!stat) return
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('ASSISTANT_RUNTIME_CODEX_HOME_INVALID')
    }
    await rm(codexHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
