import { describe, expect, it } from 'vitest'
import {
  buildTaskProgressGroupId,
  readTaskPayloadProgressGroupId,
  withTaskProgressGroupPayload,
} from '@/lib/task/progress-group'

describe('task progress group', () => {
  it('builds a stable operation progress group only when operation metadata is complete', () => {
    expect(buildTaskProgressGroupId({
      operationId: 'generate_creative_resources',
      operationRequestId: 'request-1',
    })).toBe('operation:generate_creative_resources:request-1')

    expect(buildTaskProgressGroupId({
      operationId: 'generate_creative_resources',
      operationRequestId: '',
    })).toBeNull()
    expect(buildTaskProgressGroupId({
      operationId: null,
      operationRequestId: 'request-1',
    })).toBeNull()
  })

  it('writes and reads progress group id inside task ui payload without dropping existing fields', () => {
    const payload = withTaskProgressGroupPayload({
      prompt: 'shot image',
      ui: {
        intent: 'generate',
        hasOutputAtStart: false,
      },
    }, 'operation:generate_creative_resources:request-1')

    expect(payload).toEqual({
      prompt: 'shot image',
      ui: {
        intent: 'generate',
        hasOutputAtStart: false,
        progressGroupId: 'operation:generate_creative_resources:request-1',
      },
    })
    expect(readTaskPayloadProgressGroupId(payload)).toBe('operation:generate_creative_resources:request-1')
  })
})
