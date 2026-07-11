import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import type { UIMessage } from 'ai'
import { createScopedLogger } from '@/lib/logging/core'
import { createProjectAgentChatResponse } from './runtime'
import {
  claimProjectAgentWaitContinuation,
  beginProjectAgentWaitContinuationExecution,
  extendProjectAgentWaitContinuationClaim,
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
import { createProjectAgentRunFence } from './run-fence'
import {
  finalizeProjectAgentContinuationHandoff,
  loadProjectAgentContinuationCheckpoint,
  recoverProjectAgentPreparedExecutionHandoff,
  settleProjectAgentContinuationTerminalHandoff,
} from './execution-handoff'
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

function buildContinuationDeliveryExhaustedMessage(params: {
  runId: string
  commandId: string
}): UIMessage {
  return {
    id: `workspace-continuation-delivery-exhausted:${params.commandId}`,
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
        stopReason: 'continuation_delivery_exhausted',
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
  claimSignal: AbortSignal
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
    let resolveSettlement: (() => void) | null = null
    let rejectSettlement: ((error: unknown) => void) | null = null
    const settlementCompletion = new Promise<void>((resolve, reject) => {
      resolveSettlement = resolve
      rejectSettlement = reject
    })
    // The stream may report settlement failure before its body drain returns.
    // Mark that rejection as observed now; the awaited promise below still
    // propagates the same failure to the Outbox worker.
    void settlementCompletion.catch(() => undefined)
    let settlementCompleted = false
    const settleCompletion = (): void => {
      if (settlementCompleted) return
      settlementCompleted = true
      resolveSettlement?.()
    }
    const failCompletion = (error: unknown): void => {
      if (settlementCompleted) return
      settlementCompleted = true
      rejectSettlement?.(error)
    }
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
      await finalizeProjectAgentContinuationHandoff({
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
      const recoveredRun = await getProjectAgentRun({
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId,
        runId: run.id,
      })
      if (!recoveredRun) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${run.id}`)
      const recovered = await recoverProjectAgentPreparedExecutionHandoff({
        executionFence: {
          runFence: createProjectAgentRunFence(recoveredRun),
          signal: params.claimSignal,
          continuationClaim: {
            waitId: params.followUp.waitId,
            commandId: params.commandId,
            claimOwner: params.claimOwner,
          },
        },
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId,
        assistantId: 'workspace-command',
        executionSegmentId: `wait-continuation:${params.commandId}`,
        continuation: {
          waitId: params.followUp.waitId,
          commandId: params.commandId,
          claimOwner: params.claimOwner,
          waitActivityId: consumed.activityId ?? (() => {
            throw new Error(`PROJECT_AGENT_WAIT_ACTIVITY_MISSING:${consumed.waitId}`)
          })(),
        },
      })
      if (recovered) return true
      await settleProjectAgentContinuationTerminalHandoff({
        runId: run.id,
        waitId: params.followUp.waitId,
        commandId: params.commandId,
        claimOwner: params.claimOwner,
        projectId: params.projectId,
        userId: params.userId,
        outcome: 'outcome_unknown',
        message: buildContinuationOutcomeUnknownMessage({
          runId: run.id,
          commandId: params.commandId,
        }),
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
      ownershipSignal: params.claimSignal,
      continuationClaim: {
        waitId: params.followUp.waitId,
        commandId: params.commandId,
        claimOwner: params.claimOwner,
      },
      settleTaskFollowUp: async (settlement) => {
        try {
          await settleProjectAgentContinuationTerminalHandoff({
            runId: continuationRunId,
            waitId: params.followUp.waitId,
            commandId: params.commandId,
            claimOwner: params.claimOwner,
            projectId: params.projectId,
            userId: params.userId,
            outcome: settlement.outcome,
            message: settlement.message,
          })
          settleCompletion()
        } catch (error) {
          failCompletion(error)
          throw error
        }
      },
      confirmTaskFollowUpSettlement: async () => {
        settleCompletion()
      },
      onTaskFollowUpSettlementFailure: failCompletion,
    })
    lock = null
    await drainResponseBody(response)
    await settlementCompletion
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
  if (claim.status === 'abandoned') return
  if (claim.status === 'busy') throw new Error(`PROJECT_AGENT_CONTINUATION_BUSY:${command.waitId}`)
  if (claim.status === 'stale_or_not_claimable') {
    throw new OutboxPermanentError(
      `PROJECT_AGENT_CONTINUATION_STALE:${command.waitId}:${command.runId}:${String(command.expectedRunVersion)}:${command.expectedEventSeq}`,
    )
  }
  const checkpoint = await loadProjectAgentContinuationCheckpoint({
    waitId: command.waitId,
    runId: command.runId,
    commandId: outboxId,
  })
  if (checkpoint) {
    await finalizeProjectAgentContinuationHandoff({
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
  const claimAbortController = new AbortController()
  const loseClaimLease = (): void => {
    claimLeaseLost = true
    if (!claimAbortController.signal.aborted) {
      claimAbortController.abort(new Error(`PROJECT_AGENT_CONTINUATION_CLAIM_LEASE_LOST:${command.waitId}`))
    }
  }
  const claimHeartbeat = setInterval(() => {
    void extendProjectAgentWaitContinuationClaim({
      waitId: command.waitId,
      commandId: outboxId,
      claimOwner,
      claimTtlMs: 10 * 60 * 1000,
    }).then((extended) => {
      if (!extended) loseClaimLease()
    }).catch(() => {
      loseClaimLease()
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
      claimSignal: claimAbortController.signal,
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

export type ProjectAgentContinuationDeliveryExhaustedSettlement =
  | 'settled'
  | 'already_settled'
  | 'not_applicable'

export async function settleProjectAgentWaitContinuationDeliveryExhausted(
  command: ProjectAgentContinueWaitCommand,
  outboxId: string,
): Promise<ProjectAgentContinuationDeliveryExhaustedSettlement> {
  const claimOwner = randomUUID()
  const claim = await claimProjectAgentWaitContinuation({
    waitId: command.waitId,
    runId: command.runId,
    expectedRunVersion: command.expectedRunVersion,
    expectedEventSeq: command.expectedEventSeq,
    commandId: outboxId,
    claimOwner,
  })
  if (claim.status === 'already_followed') return 'already_settled'
  if (claim.status === 'abandoned' || claim.status === 'stale_or_not_claimable') {
    return 'not_applicable'
  }
  if (claim.status === 'busy') {
    throw new Error(`PROJECT_AGENT_CONTINUATION_DELIVERY_SETTLEMENT_BUSY:${command.waitId}`)
  }

  const consumed = await startProjectAgentWaitFollowUp({
    runId: command.runId,
    waitId: command.waitId,
    commandId: outboxId,
    claimOwner,
    projectId: claim.projectId,
    userId: claim.userId,
  })
  if (!consumed) {
    throw new Error(`PROJECT_AGENT_CONTINUATION_DELIVERY_SETTLEMENT_NOT_STARTED:${command.waitId}`)
  }

  const executionStart = await beginProjectAgentWaitContinuationExecution({
    runId: command.runId,
    waitId: command.waitId,
    commandId: outboxId,
    claimOwner,
    projectId: claim.projectId,
    userId: claim.userId,
  })
  if (executionStart !== 'settled') {
    const outcome = executionStart === 'already_started'
      ? 'outcome_unknown' as const
      : 'delivery_exhausted' as const
    await settleProjectAgentContinuationTerminalHandoff({
      runId: command.runId,
      waitId: command.waitId,
      commandId: outboxId,
      claimOwner,
      projectId: claim.projectId,
      userId: claim.userId,
      outcome,
      message: outcome === 'outcome_unknown'
        ? buildContinuationOutcomeUnknownMessage({ runId: command.runId, commandId: outboxId })
        : buildContinuationDeliveryExhaustedMessage({ runId: command.runId, commandId: outboxId }),
    })
  }
  if (executionStart === 'settled') {
    await finalizeProjectAgentContinuationHandoff({
      runId: command.runId,
      waitId: command.waitId,
      commandId: outboxId,
      claimOwner,
      projectId: claim.projectId,
      userId: claim.userId,
    })
  }
  return 'settled'
}
