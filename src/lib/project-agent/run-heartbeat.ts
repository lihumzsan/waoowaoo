import { createScopedLogger } from '@/lib/logging/core'
import {
  PROJECT_AGENT_RUN_HEARTBEAT_INTERVAL_MS,
  touchProjectAgentRunHeartbeat,
} from './runs'
import {
  renewProjectAgentRunLock,
  type ProjectAgentRunLock,
} from './run-lock'

const projectAgentRunHeartbeatLogger = createScopedLogger({
  module: 'project-agent.run-heartbeat',
})

export interface ProjectAgentRunHeartbeatController {
  stop: () => Promise<void>
}

export class ProjectAgentRunOwnershipLostError extends Error {
  constructor(params: {
    runId: string
    reason: 'run_not_running' | 'lock_not_owned' | 'heartbeat_failed'
    cause?: unknown
  }) {
    super(`PROJECT_AGENT_RUN_OWNERSHIP_LOST runId=${params.runId} reason=${params.reason}`, {
      cause: params.cause,
    })
    this.name = 'ProjectAgentRunOwnershipLostError'
  }
}

export function isProjectAgentRunOwnershipLostError(
  value: unknown,
): value is ProjectAgentRunOwnershipLostError {
  return value instanceof ProjectAgentRunOwnershipLostError
}

export function startProjectAgentRunHeartbeat(input: {
  runId: string
  runLock?: ProjectAgentRunLock | null
  intervalMs?: number
  onOwnershipLost: (error: ProjectAgentRunOwnershipLostError) => void
}): ProjectAgentRunHeartbeatController {
  let stopped = false
  let ownershipLost = false
  let inFlight: Promise<void> = Promise.resolve()
  const intervalMs = input.intervalMs ?? PROJECT_AGENT_RUN_HEARTBEAT_INTERVAL_MS

  const beat = async (): Promise<void> => {
    if (stopped || ownershipLost) return
    const touched = await touchProjectAgentRunHeartbeat({ runId: input.runId })
    /*
     * `running` is a business status. A durable handoff can legitimately move
     * the Run to a waiting status before this stream has observed its final
     * settlement. The Redis lease, not that status, is this execution
     * segment's ownership claim; a waiting status must therefore never revoke
     * a still-owned segment.
     */
    if (!touched && !input.runLock) {
      throw new ProjectAgentRunOwnershipLostError({
        runId: input.runId,
        reason: 'run_not_running',
      })
    }
    if (input.runLock) {
      const renewed = await renewProjectAgentRunLock(input.runLock)
      if (!renewed) {
        throw new ProjectAgentRunOwnershipLostError({
          runId: input.runId,
          reason: 'lock_not_owned',
        })
      }
    }
  }

  const loseOwnership = (error: unknown): void => {
    if (ownershipLost || stopped) return
    ownershipLost = true
    const ownershipError = error instanceof ProjectAgentRunOwnershipLostError
      ? error
      : new ProjectAgentRunOwnershipLostError({
          runId: input.runId,
          reason: 'heartbeat_failed',
          cause: error,
        })
    input.onOwnershipLost(ownershipError)
    projectAgentRunHeartbeatLogger.error({
      action: 'assistant.run-heartbeat.ownership-lost',
      message: 'Project agent run ownership was lost',
      details: {
        runId: input.runId,
        error: ownershipError.message,
      },
    })
  }

  const enqueueBeat = (): void => {
    inFlight = inFlight
      .catch(() => undefined)
      .then(beat)
      .catch((error: unknown) => {
        loseOwnership(error)
      })
  }

  enqueueBeat()
  const timer = setInterval(enqueueBeat, intervalMs)

  return {
    async stop(): Promise<void> {
      stopped = true
      clearInterval(timer)
      await inFlight.catch(() => undefined)
    },
  }
}
