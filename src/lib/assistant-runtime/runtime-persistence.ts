import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { materializeWorkspaceBundle } from '@/lib/codex-runtime/workspace-bundle'
import type {
  RuntimeSessionMaterialization,
  RuntimeSessionPersistence,
  RuntimeSessionScope,
} from '@/lib/codex-runtime/runtime-session-manager'
import { readCodexRuntimeWorkspace } from '@/lib/codex-workspace'
import { materializeCreativeRuntimeConfiguration } from '@/lib/creative-skills'
import { prisma } from '@/lib/prisma'
import { captureCodexStateBundle, restoreCodexStateBundle, saveCodexStateBundle } from './codex-state-store'
import { markAssistantRuntimeProjectTurnsInterrupted } from './persistence'

const MATERIALIZATION_PREFIX = 'wao-codex-runtime-'

type MaterializationLayout = {
  readonly root: string
  readonly workspace: string
  readonly codexHome: string
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
  return { root, workspace, codexHome }
}

async function checkpointRuntimeThreadBinding(input: {
  readonly scope: RuntimeSessionScope
  readonly productThreadId: string
  readonly runtimeThreadId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const thread = await tx.projectAssistantThread.findUnique({ where: { id: input.productThreadId } })
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
      const projection = await readCodexRuntimeWorkspace({ projectId: scope.projectId, userId: scope.userId })
      await materializeWorkspaceBundle(workspace, projection.runtimeBundle)
      await restoreCodexStateBundle({ scope, codexHomeDirectory: codexHome })
      await materializeCreativeRuntimeConfiguration(codexHome)
      return { hostWorkspaceDirectory: workspace, hostCodexHomeDirectory: codexHome }
    } catch (error) {
      await rm(root, { recursive: true, force: true })
      throw error
    }
  }

  async checkpointRuntime(params: Parameters<RuntimeSessionPersistence['checkpointRuntime']>[0]): Promise<void> {
    const layout = layoutFromMaterialization(params.materialization, this.hostRoot)
    await saveCodexStateBundle({ scope: params.scope, codexHomeDirectory: layout.codexHome })
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
