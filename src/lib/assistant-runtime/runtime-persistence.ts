import { chmod, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  buildRuntimeSessionScopeId,
  type RuntimeSessionMaterialization,
  type RuntimeSessionPersistence,
  type RuntimeSessionScope,
} from '@/lib/codex-runtime/runtime-session-manager'
import { materializeCreativeRuntimeConfiguration } from '@/lib/creative-skills'
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
  const codexHome = path.resolve(materialization.hostCodexHomeDirectory)
  const codexHomesRoot = path.join(hostRoot, CODEX_HOME_DIRECTORY)
  if (
    path.basename(workspace) !== 'workspace'
    || path.dirname(disposableRoot) !== materializationsRoot
    || !path.basename(disposableRoot).startsWith(MATERIALIZATION_PREFIX)
    || path.dirname(codexHome) !== codexHomesRoot
    || !path.basename(codexHome)
  ) {
    throw new Error('ASSISTANT_RUNTIME_MATERIALIZATION_LAYOUT_INVALID')
  }
  return disposableRoot
}

function scopeCodexHome(hostRoot: string, scope: RuntimeSessionScope): string {
  return path.join(hostRoot, CODEX_HOME_DIRECTORY, buildRuntimeSessionScopeId(scope))
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
    const materializationsRoot = path.join(this.hostRoot, MATERIALIZATION_DIRECTORY)
    const codexHomesRoot = path.join(this.hostRoot, CODEX_HOME_DIRECTORY)
    await ensurePrivateDirectory(this.hostRoot)
    await ensurePrivateDirectory(materializationsRoot)
    await ensurePrivateDirectory(codexHomesRoot)

    const codexHome = scopeCodexHome(this.hostRoot, scope)
    await ensurePrivateDirectory(codexHome)

    const disposableRoot = await mkdtemp(path.join(materializationsRoot, MATERIALIZATION_PREFIX))
    const workspace = path.join(disposableRoot, 'workspace')
    try {
      await ensurePrivateDirectory(workspace)
      await materializeCreativeRuntimeConfiguration(
        codexHome,
        path.join(workspace, '.agents', 'skills'),
      )
      return {
        hostWorkspaceDirectory: workspace,
        hostCodexHomeDirectory: codexHome,
      }
    } catch (error) {
      await rm(disposableRoot, { recursive: true, force: true })
      throw error
    }
  }

  async destroyMaterialization(materialization: RuntimeSessionMaterialization): Promise<void> {
    const disposableRoot = requireDisposableRoot(materialization, this.hostRoot)
    await rm(disposableRoot, { recursive: true, force: true })
  }

  async clearScope(scope: RuntimeSessionScope): Promise<void> {
    await ensurePrivateDirectory(this.hostRoot)
    const codexHomesRoot = path.join(this.hostRoot, CODEX_HOME_DIRECTORY)
    await ensurePrivateDirectory(codexHomesRoot)
    const codexHome = scopeCodexHome(this.hostRoot, scope)
    const stat = await lstat(codexHome).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (!stat) return
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('ASSISTANT_RUNTIME_CODEX_HOME_INVALID')
    }
    await rm(codexHome, { recursive: true, force: true })
  }
}
