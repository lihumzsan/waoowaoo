import { describe, expect, it } from 'vitest'
import { parseOutboxCommandPayload } from '@/lib/outbox/types'

describe('Project Agent Session broadcast Outbox contract', () => {
  it('parses the canonical bigint ProjectAgentEvent identity', () => {
    expect(parseOutboxCommandPayload({
      kind: 'project_agent.session_broadcast',
      version: 1,
      projectAgentEventId: '9007199254740993',
    })).toEqual({
      kind: 'project_agent.session_broadcast',
      version: 1,
      projectAgentEventId: '9007199254740993',
    })
  })

  it('rejects non-canonical event identities instead of guessing', () => {
    expect(() => parseOutboxCommandPayload({
      kind: 'project_agent.session_broadcast',
      version: 1,
      projectAgentEventId: '0042',
    })).toThrow('OUTBOX_COMMAND_PROJECTAGENTEVENTID_INVALID_BIGINT')
  })
})
