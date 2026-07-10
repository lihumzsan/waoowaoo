import { NextRequest } from 'next/server'
import type { UIMessage } from 'ai'
import { createScopedLogger } from '@/lib/logging/core'
import { createProjectAgentChatResponse } from './runtime'
import {
  claimResolvedProjectAgentWaitFollowUps,
  consumeProjectAgentWaitFollowUp,
  type ProjectAgentWaitFollowUp,
} from './waits'
import {
  getProjectAgentRun,
  safelyUpdateProjectAgentRunStatus,
  type ProjectAgentRunRecord,
} from './runs'
import {
  acquireProjectAgentRunLock,
  safelyReleaseProjectAgentRunLock,
  type ProjectAgentRunLock,
} from './run-lock'
import { loadProjectAssistantThread } from './persistence'

const logger = createScopedLogger({ module: 'project-agent.server-follow-up' })
let scheduledFollowUpChain: Promise<void> = Promise.resolve()

function buildServerFollowUpMessage(followUp: ProjectAgentWaitFollowUp): UIMessage {
  return {
    id: `workspace-server-task-follow-up:${followUp.waitId}:${followUp.claimId}`,
    role: 'user',
    metadata: {
      custom: {
        workspaceAssistantHidden: true,
      },
    },
    parts: [{
      type: 'text',
      text: [
        '[task_update]',
        `waitId=${followUp.waitId}`,
        `operationId=${followUp.operationId}`,
        `terminalStatus=${followUp.terminalStatus}`,
        `successCount=${String(followUp.successCount)}`,
        `failedCount=${String(followUp.failedCount)}`,
        '[/task_update]',
      ].join(' '),
    }],
  }
}

async function drainResponseBody(response: Response): Promise<void> {
  if (!response.body) return
  const reader = response.body.getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return
    }
  } finally {
    reader.releaseLock()
  }
}

async function loadRunForFollowUp(params: {
  projectId: string
  userId: string
  episodeId: string | null
  followUp: ProjectAgentWaitFollowUp
}): Promise<ProjectAgentRunRecord | null> {
  if (!params.followUp.runId) return null
  return await getProjectAgentRun({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
    runId: params.followUp.runId,
  })
}

async function runClaimedFollowUp(params: {
  projectId: string
  userId: string
  episodeId: string | null
  followUp: ProjectAgentWaitFollowUp
}): Promise<boolean> {
  if (params.followUp.followUpMode !== 'resume_agent') return false
  const run = await loadRunForFollowUp(params)
  if (!run) {
    logger.warn({
      action: 'assistant.wait-follow-up.run-missing',
      message: 'Server-side project agent follow-up skipped because the source run is missing',
      projectId: params.projectId,
      userId: params.userId,
      details: {
        waitId: params.followUp.waitId,
        runId: params.followUp.runId,
      },
    })
    return false
  }

  const runLock = await acquireProjectAgentRunLock({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
    runId: run.id,
  })
  if (!runLock) return false

  let lock: ProjectAgentRunLock | null = runLock
  try {
    const consumed = await consumeProjectAgentWaitFollowUp({
      runId: run.id,
      waitId: params.followUp.waitId,
      claimId: params.followUp.claimId,
      projectId: params.projectId,
      userId: params.userId,
    })
    if (!consumed) return false

    const thread = await loadProjectAssistantThread({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId,
      assistantId: 'workspace-command',
    })
    const messages = [
      ...(thread?.messages ?? []),
      buildServerFollowUpMessage(consumed),
    ]
    const request = new NextRequest(`http://localhost/api/projects/${params.projectId}/assistant/server-follow-up`, {
      method: 'POST',
      headers: {
        'x-project-agent-server-follow-up': '1',
      },
    })
    const response = await createProjectAgentChatResponse({
      request,
      userId: params.userId,
      projectId: params.projectId,
      context: {
        episodeId: params.episodeId,
      },
      messages,
      assistantPermissionMode: 'ask',
      run,
      control: {
        kind: 'task_follow_up',
        followUp: consumed,
      },
      runLock: lock,
    })
    lock = null
    await drainResponseBody(response)
    return true
  } catch (error) {
    await safelyUpdateProjectAgentRunStatus({
      runId: run.id,
      status: 'failed',
      stopReason: 'server_task_follow_up_failed',
      errorCode: 'PROJECT_AGENT_SERVER_FOLLOW_UP_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    logger.error({
      action: 'assistant.wait-follow-up.failed',
      message: 'Server-side project agent follow-up failed',
      projectId: params.projectId,
      userId: params.userId,
      details: {
        waitId: params.followUp.waitId,
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return false
  } finally {
    if (lock) await safelyReleaseProjectAgentRunLock(lock)
  }
}

export async function runResolvedProjectAgentWaitFollowUpsForTaskEvent(input: {
  projectId: string
  userId: string
  episodeId?: string | null
}): Promise<{ claimed: number; ran: number }> {
  const scopes = input.episodeId
    ? [input.episodeId, null]
    : [null]
  let claimed = 0
  let ran = 0
  for (const episodeId of scopes) {
    const followUps = await claimResolvedProjectAgentWaitFollowUps({
      projectId: input.projectId,
      userId: input.userId,
      episodeId,
      assistantId: 'workspace-command',
      followUpMode: 'resume_agent',
      limit: 5,
      claimTtlMs: 30_000,
    })
    claimed += followUps.length
    for (const followUp of followUps) {
      const didRun = await runClaimedFollowUp({
        projectId: input.projectId,
        userId: input.userId,
        episodeId,
        followUp,
      })
      if (didRun) ran += 1
    }
  }
  return { claimed, ran }
}

export function scheduleResolvedProjectAgentWaitFollowUpsForTaskEvent(input: {
  projectId: string
  userId: string
  episodeId?: string | null
}): void {
  scheduledFollowUpChain = scheduledFollowUpChain
    .catch(() => undefined)
    .then(async () => {
      try {
        await runResolvedProjectAgentWaitFollowUpsForTaskEvent(input)
      } catch (error) {
        logger.error({
          action: 'assistant.wait-follow-up.schedule-failed',
          message: 'Scheduled server-side project agent follow-up failed',
          projectId: input.projectId,
          userId: input.userId,
          details: {
            episodeId: input.episodeId ?? null,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      }
    })
}

export async function flushScheduledProjectAgentWaitFollowUpsForTest(): Promise<void> {
  await scheduledFollowUpChain
}
