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

export function startProjectAgentRunHeartbeat(input: {
  runId: string
  runLock?: ProjectAgentRunLock | null
  intervalMs?: number
}): ProjectAgentRunHeartbeatController {
  let stopped = false
  let inFlight: Promise<void> = Promise.resolve()
  const intervalMs = input.intervalMs ?? PROJECT_AGENT_RUN_HEARTBEAT_INTERVAL_MS

  const beat = async (): Promise<void> => {
    if (stopped) return
    await touchProjectAgentRunHeartbeat({ runId: input.runId })
    if (input.runLock) {
      await renewProjectAgentRunLock(input.runLock)
    }
  }

  const enqueueBeat = (): void => {
    inFlight = inFlight
      .catch(() => undefined)
      .then(beat)
      .catch((error: unknown) => {
        projectAgentRunHeartbeatLogger.error({
          action: 'assistant.run-heartbeat.failed',
          message: 'Failed to update project agent run heartbeat',
          details: {
            runId: input.runId,
            error: error instanceof Error ? error.message : String(error),
          },
        })
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
