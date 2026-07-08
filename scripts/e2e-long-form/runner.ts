import { setTimeout as sleep } from 'node:timers/promises'
import { prisma } from '@/lib/prisma'
import { E2eApiClient } from './api-client'
import { readFollowUpAction, readNextActionFromSessionState } from './actions'
import { readE2eDiagnostics } from './diagnostics'
import type { E2eDiagnostics } from './diagnostics-types'
import { authenticateE2eClient, E2eHttpClient } from './http-client'
import { writeE2eReport } from './reporter'
import { isTargetStageReached } from './stages'
import type { E2eFailure, E2eProjectScope, E2eRunnerConfig, E2eRunResult } from './types'
import {
  createE2eWatchdogState,
  findE2eTerminalFailure,
  updateE2eWatchdogState,
  type E2eWatchdogState,
} from './watchdog'

function buildWorkspaceUrl(config: E2eRunnerConfig, scope: E2eProjectScope | null): string | null {
  if (!scope) return null
  const url = new URL(`/${config.locale}/workspace/${scope.projectId}`, config.baseUrl)
  url.searchParams.set('episode', scope.episodeId)
  return url.toString()
}

async function readScopeFromProject(input: {
  readonly projectId: string
  readonly episodeId: string | null
}): Promise<E2eProjectScope> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      userId: true,
      episodes: {
        where: input.episodeId ? { id: input.episodeId } : undefined,
        orderBy: { episodeNumber: 'asc' },
        take: 1,
        select: { id: true },
      },
    },
  })
  if (!project) throw new Error(`E2E_PROJECT_NOT_FOUND:${input.projectId}`)
  const episode = project.episodes[0]
  if (!episode) throw new Error(`E2E_EPISODE_NOT_FOUND:${input.episodeId ?? 'first'}`)
  return {
    projectId: project.id,
    episodeId: episode.id,
    userId: project.userId,
  }
}

async function createScope(input: {
  readonly config: E2eRunnerConfig
  readonly api: E2eApiClient
}): Promise<E2eProjectScope> {
  if (input.config.projectId) {
    return await readScopeFromProject({
      projectId: input.config.projectId,
      episodeId: input.config.episodeId,
    })
  }
  const projectId = await input.api.createProject(input.config.projectName)
  const episodeId = await input.api.createEpisode({
    projectId,
    name: input.config.episodeName,
  })
  return await readScopeFromProject({ projectId, episodeId })
}

function hasActiveTasks(diagnostics: E2eDiagnostics): boolean {
  return diagnostics.tasks.some((task) => task.status === 'queued' || task.status === 'processing')
}

function hasActiveRun(diagnostics: E2eDiagnostics): boolean {
  return diagnostics.runs.some((run) =>
    run.status === 'running'
    || run.status === 'awaiting_approval'
    || run.status === 'awaiting_choice'
    || run.status === 'awaiting_task')
}

async function readAndApplyNextAction(input: {
  readonly config: E2eRunnerConfig
  readonly api: E2eApiClient
  readonly scope: E2eProjectScope
}): Promise<boolean> {
  const sessionState = await input.api.getSessionState({
    projectId: input.scope.projectId,
    episodeId: input.scope.episodeId,
    locale: input.config.locale,
  })
  const nextAction = readNextActionFromSessionState(input.config, sessionState)
  if (nextAction?.kind === 'choice') {
    await input.api.submitChoice({
      projectId: input.scope.projectId,
      episodeId: input.scope.episodeId,
      locale: input.config.locale,
      assistantPermissionMode: input.config.assistantPermissionMode,
      visibleUserText: 'E2E accepted the pending choice.',
      action: nextAction.action,
    })
    return true
  }
  if (nextAction?.kind === 'approval') {
    await input.api.submitApproval({
      projectId: input.scope.projectId,
      episodeId: input.scope.episodeId,
      locale: input.config.locale,
      assistantPermissionMode: input.config.assistantPermissionMode,
      action: nextAction.action,
    })
    return true
  }

  const claimed = await input.api.claimTaskFollowUp({
    projectId: input.scope.projectId,
    episodeId: input.scope.episodeId,
  })
  const followUp = readFollowUpAction(claimed)
  if (!followUp) return false
  await input.api.submitTaskFollowUp({
    projectId: input.scope.projectId,
    episodeId: input.scope.episodeId,
    locale: input.config.locale,
    assistantPermissionMode: input.config.assistantPermissionMode,
    action: followUp,
  })
  return true
}

async function finalizeRun(input: {
  readonly config: E2eRunnerConfig
  readonly scope: E2eProjectScope | null
  readonly startedAt: number
  readonly diagnostics: E2eDiagnostics | null
  readonly failure: E2eFailure | null
}): Promise<E2eRunResult> {
  const resultWithoutReport = {
    status: input.failure?.status ?? 'PASS',
    projectId: input.scope?.projectId ?? null,
    episodeId: input.scope?.episodeId ?? null,
    workspaceUrl: buildWorkspaceUrl(input.config, input.scope),
    target: input.config.target,
    elapsedMs: Date.now() - input.startedAt,
    failure: input.failure,
  } satisfies Omit<E2eRunResult, 'reportPath'>
  const reportPath = await writeE2eReport({
    config: input.config,
    result: resultWithoutReport,
    diagnostics: input.diagnostics,
  })
  return {
    ...resultWithoutReport,
    reportPath,
  }
}

export async function runLongFormE2e(config: E2eRunnerConfig): Promise<E2eRunResult> {
  const startedAt = Date.now()
  const http = new E2eHttpClient(config.baseUrl)
  const api = new E2eApiClient(http)
  let scope: E2eProjectScope | null = null
  let diagnostics: E2eDiagnostics | null = null
  let watchdog: E2eWatchdogState = createE2eWatchdogState(startedAt)

  try {
    await authenticateE2eClient({
      client: http,
      baseUrl: config.baseUrl,
      username: config.username,
      password: config.password,
      sessionCookie: config.sessionCookie,
    })
    scope = await createScope({ config, api })
    if (!config.projectId) {
      await api.sendUserMessage({
        projectId: scope.projectId,
        episodeId: scope.episodeId,
        text: config.prompt,
        locale: config.locale,
        assistantPermissionMode: config.assistantPermissionMode,
      })
    }

    while (true) {
      diagnostics = await readE2eDiagnostics({
        projectId: scope.projectId,
        episodeId: scope.episodeId,
      })
      watchdog = updateE2eWatchdogState({ state: watchdog, diagnostics })

      if (isTargetStageReached({
        currentWorkflowStage: diagnostics.workflow.stage,
        target: config.target,
      })) {
        return await finalizeRun({
          config,
          scope,
          startedAt,
          diagnostics,
          failure: null,
        })
      }

      const failure = findE2eTerminalFailure({
        diagnostics,
        stageTimeoutMs: config.stageTimeoutMs,
        overallTimeoutMs: config.overallTimeoutMs,
        state: watchdog,
      })
      if (failure) {
        return await finalizeRun({
          config,
          scope,
          startedAt,
          diagnostics,
          failure,
        })
      }

      const actionApplied = await readAndApplyNextAction({ config, api, scope })
      if (!actionApplied && !hasActiveTasks(diagnostics) && !hasActiveRun(diagnostics)) {
        watchdog = {
          ...watchdog,
          lastProgressAt: Math.min(watchdog.lastProgressAt, Date.now() - config.stageTimeoutMs - 1),
        }
      }
      await sleep(config.pollIntervalMs)
    }
  } catch (error) {
    const failure: E2eFailure = {
      status: 'SYSTEM_FAIL',
      code: 'E2E_RUNNER_ERROR',
      message: error instanceof Error ? error.message : String(error),
    }
    return await finalizeRun({
      config,
      scope,
      startedAt,
      diagnostics,
      failure,
    })
  }
}
