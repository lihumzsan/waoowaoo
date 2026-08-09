import { chmod, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  type RuntimeSessionMaterialization,
  type RuntimeSessionPersistence,
  type RuntimeSessionScope,
} from '@/lib/codex-runtime/runtime-session-manager'
import { materializeCreativeRuntimeConfiguration } from '@/lib/creative-skills'
import { markAssistantRuntimeProjectTurnsInterrupted } from './persistence'

const MATERIALIZATION_DIRECTORY = 'materializations'
const MATERIALIZATION_PREFIX = 'wao-codex-runtime-'

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
    await ensurePrivateDirectory(this.hostRoot)
    await ensurePrivateDirectory(materializationsRoot)

    const disposableRoot = await mkdtemp(path.join(materializationsRoot, MATERIALIZATION_PREFIX))
    const workspace = path.join(disposableRoot, 'workspace')
    try {
      await ensurePrivateDirectory(workspace)
      await materializeCreativeRuntimeConfiguration(path.join(workspace, '.agents', 'skills'))
      return {
        hostWorkspaceDirectory: workspace,
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
    void scope
  }
}
