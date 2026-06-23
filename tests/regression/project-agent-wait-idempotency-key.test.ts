import { describe, expect, it } from 'vitest'
import {
  buildProjectAgentTaskProgressedIdempotencyKey,
  buildProjectAgentTaskTerminalIdempotencyKey,
  PROJECT_AGENT_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH,
} from '@/lib/project-agent/waits'

const stuckBatchWaitId = 'f8432b7b-fd45-4a4c-908c-6fcf748b6540'
const stuckBatchTaskIds = [
  '1f1d8da5-9f55-4c9f-8f53-b1aeae64e77b',
  '6c3d99ce-984d-4681-a0ff-eaf2f69e2478',
  '6f644b45-4add-4c56-974a-fc7baf72549d',
  'a1f575da-3bcc-4ead-9574-1a9bed9a47b0',
]

describe('project agent wait idempotency key regression', () => {
  it('[regression] resolves a four-task batch without generating an overlong terminal event key', () => {
    const key = buildProjectAgentTaskTerminalIdempotencyKey({
      waitId: stuckBatchWaitId,
      terminalStatus: 'completed',
      terminalTaskIds: stuckBatchTaskIds,
      failedTaskIds: [],
    })

    expect(key.length).toBeLessThanOrEqual(PROJECT_AGENT_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH)
    expect(key).toMatch(/^task-terminal:f8432b7b-fd45-4a4c-908c-6fcf748b6540:completed:[a-f0-9]{64}$/)
    expect(key).not.toContain(stuckBatchTaskIds.join(','))
  })

  it('[regression] keeps progressed event keys stable for the same terminal task snapshot', () => {
    const first = buildProjectAgentTaskProgressedIdempotencyKey({
      waitId: stuckBatchWaitId,
      terminalTaskIds: [stuckBatchTaskIds[1], stuckBatchTaskIds[0]],
      failedTaskIds: [],
    })
    const reordered = buildProjectAgentTaskProgressedIdempotencyKey({
      waitId: stuckBatchWaitId,
      terminalTaskIds: [stuckBatchTaskIds[0], stuckBatchTaskIds[1]],
      failedTaskIds: [],
    })
    const failed = buildProjectAgentTaskProgressedIdempotencyKey({
      waitId: stuckBatchWaitId,
      terminalTaskIds: [stuckBatchTaskIds[0], stuckBatchTaskIds[1]],
      failedTaskIds: [stuckBatchTaskIds[1]],
    })

    expect(first).toBe(reordered)
    expect(first).not.toBe(failed)
    expect(first.length).toBeLessThanOrEqual(PROJECT_AGENT_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH)
  })
})
