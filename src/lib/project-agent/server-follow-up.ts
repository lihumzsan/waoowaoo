import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import type { UIMessage } from 'ai'
import { createScopedLogger } from '@/lib/logging/core'
import { createProjectAgentChatResponse } from './runtime'
import {
  claimProjectAgentWaitContinuation,
  beginProjectAgentWaitContinuationExecution,
  checkpointProjectAgentWaitFollowUp,
  finalizeProjectAgentWaitFollowUp,
  extendProjectAgentWaitContinuationClaim,
  loadProjectAgentWaitContinuationCheckpoint,
  releaseProjectAgentWaitContinuationClaim,
  startProjectAgentWaitFollowUp,
  type ProjectAgentWaitFollowUp,
} from './waits'
import type { ProjectAgentContinueWaitCommand } from '@/lib/outbox/types'
import { OutboxPermanentError } from '@/lib/outbox/types'
import {
  getProjectAgentRun,
  type ProjectAgentRunRecord,
} from './runs'
import {
  acquireProjectAgentRunLock,
  safelyReleaseProjectAgentRunLock,
  type ProjectAgentRunLock,
} from './run-lock'
import { loadProjectAssistantThread } from './persistence'

const logger = createScopedLogger({ module: 'project-agent.server-follow-up' })

function buildServerFollowUpMessage(followUp: ProjectAgentWaitFollowUp): UIMessage {
  return {
    id: `workspace-server-task-follow-up:${followUp.waitId}:${followUp.commandId}`,
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

function buildContinuationOutcomeUnknownMessage(params: {
  runId: string
  commandId: string
}): UIMessage {
  return {
    id: `workspace-continuation-outcome-unknown:${params.commandId}`,
    role: 'assistant',
    metadata: {
      custom: {
        projectAgentRunId: params.runId,
        projectAgentContinuationCommandId: params.commandId,
      },
    },
    parts: [{
      type: 'data-agent-run',
      data: {
        runId: params.runId,
        requestId: params.commandId,
        status: 'failed',
        controlKind: 'task_follow_up',
        stopReason: 'continuation_outcome_unknown',
      },
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
  commandId: string
  claimOwner: string
}): Promise<boolean> {
  let run = await loadRunForFollowUp(params)
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
    throw new OutboxPermanentError(`PROJECT_AGENT_CONTINUATION_RUN_MISSING:${String(params.followUp.runId)}`)
  }
  const continuationRunId = run.id

  const runLock = await acquireProjectAgentRunLock({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
    runId: run.id,
  })
    if (!runLock) throw new Error(`PROJECT_AGENT_CONTINUATION_RUN_LOCK_BUSY:${run.id}`)

  let lock: ProjectAgentRunLock | null = runLock
  try {
    const consumed = await startProjectAgentWaitFollowUp({
      runId: run.id,
      waitId: params.followUp.waitId,
      commandId: params.commandId,
      claimOwner: params.claimOwner,
      projectId: params.projectId,
      userId: params.userId,
    })
    if (!consumed) return false
    const executionStart = await beginProjectAgentWaitContinuationExecution({
      runId: run.id,
      waitId: params.followUp.waitId,
      commandId: params.commandId,
      claimOwner: params.claimOwner,
      projectId: params.projectId,
      userId: params.userId,
    })
    if (executionStart === 'settled') {
      await finalizeProjectAgentWaitFollowUp({
        runId: run.id,
        waitId: params.followUp.waitId,
        commandId: params.commandId,
        claimOwner: params.claimOwner,
        projectId: params.projectId,
        userId: params.userId,
      })
      return true
    }
    if (executionStart === 'already_started') {
      await checkpointProjectAgentWaitFollowUp({
        runId: run.id,
        waitId: params.followUp.waitId,
        commandId: params.commandId,
        claimOwner: params.claimOwner,
        projectId: params.projectId,
        userId: params.userId,
        outcome: 'failed',
        message: buildContinuationOutcomeUnknownMessage({
          runId: run.id,
          commandId: params.commandId,
        }),
      })
      await finalizeProjectAgentWaitFollowUp({
        runId: run.id,
        waitId: params.followUp.waitId,
        commandId: params.commandId,
        claimOwner: params.claimOwner,
        projectId: params.projectId,
        userId: params.userId,
      })
      return true
    }
    const refreshedRun = await getProjectAgentRun({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId,
      runId: run.id,
    })
    if (!refreshedRun) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${run.id}`)
    run = refreshedRun

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
        'x-request-id': params.commandId,
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
      settleTaskFollowUp: async (settlement) => {
        await checkpointProjectAgentWaitFollowUp({
          runId: continuationRunId,
          waitId: params.followUp.waitId,
          commandId: params.commandId,
          claimOwner: params.claimOwner,
          projectId: params.projectId,
          userId: params.userId,
          outcome: settlement.outcome,
          message: settlement.message,
        })
        await finalizeProjectAgentWaitFollowUp({
          runId: continuationRunId,
          waitId: params.followUp.waitId,
          commandId: params.commandId,
          claimOwner: params.claimOwner,
          projectId: params.projectId,
          userId: params.userId,
        })
      },
    })
    lock = null
    await drainResponseBody(response)
    return true
  } catch (error) {
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
    throw error
  } finally {
    if (lock) await safelyReleaseProjectAgentRunLock(lock)
  }
}

export async function runProjectAgentWaitContinuationCommand(
  command: ProjectAgentContinueWaitCommand,
  outboxId: string,
): Promise<void> {
  const claimOwner = randomUUID()
  const claim = await claimProjectAgentWaitContinuation({
    waitId: command.waitId,
    runId: command.runId,
    expectedRunVersion: command.expectedRunVersion,
    expectedEventSeq: command.expectedEventSeq,
    commandId: outboxId,
    claimOwner,
  })
  if (claim.status === 'already_followed') return
  if (claim.status === 'busy') throw new Error(`PROJECT_AGENT_CONTINUATION_BUSY:${command.waitId}`)
  if (claim.status === 'stale_or_not_claimable') {
    throw new OutboxPermanentError(
      `PROJECT_AGENT_CONTINUATION_STALE:${command.waitId}:${command.runId}:${String(command.expectedRunVersion)}:${command.expectedEventSeq}`,
    )
  }
  const checkpoint = await loadProjectAgentWaitContinuationCheckpoint({
    waitId: command.waitId,
    runId: command.runId,
    commandId: outboxId,
  })
  if (checkpoint) {
    await finalizeProjectAgentWaitFollowUp({
      runId: command.runId,
      waitId: command.waitId,
      commandId: outboxId,
      claimOwner,
      projectId: claim.projectId,
      userId: claim.userId,
    })
    return
  }
  let ran = false
  let claimLeaseLost = false
  const claimHeartbeat = setInterval(() => {
    void extendProjectAgentWaitContinuationClaim({
      waitId: command.waitId,
      commandId: outboxId,
      claimOwner,
      claimTtlMs: 10 * 60 * 1000,
    }).then((extended) => {
      if (!extended) claimLeaseLost = true
    }).catch(() => {
      claimLeaseLost = true
    })
  }, 60_000)
  try {
    ran = await runClaimedFollowUp({
      projectId: claim.projectId,
      userId: claim.userId,
      episodeId: claim.episodeId,
      followUp: claim.followUp,
      commandId: outboxId,
      claimOwner,
    })
    if (claimLeaseLost) throw new Error(`PROJECT_AGENT_CONTINUATION_CLAIM_LEASE_LOST:${command.waitId}`)
  } catch (error) {
    await releaseProjectAgentWaitContinuationClaim({
      waitId: command.waitId,
      commandId: outboxId,
      claimOwner,
    })
    throw error
  } finally {
    clearInterval(claimHeartbeat)
  }
  if (!ran) throw new Error(`PROJECT_AGENT_CONTINUATION_NOT_RUN:${command.waitId}`)
}
