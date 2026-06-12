import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  parseAssistantPermissionMode,
  shouldRequireAssistantToolApproval,
} from '@/lib/project-agent/permission-mode'
import { EFFECTS_BILLABLE, EFFECTS_NONE, makeTestOperation } from '../../helpers/project-agent-operations'

function buildOperation(id: string) {
  return makeTestOperation({
    id,
    intent: 'query',
    effects: EFFECTS_NONE,
    confirmation: { required: false },
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true }),
  })
}

describe('assistant permission mode', () => {
  it('parses only explicit ask or auto modes', () => {
    expect(parseAssistantPermissionMode('ask')).toBe('ask')
    expect(parseAssistantPermissionMode('auto')).toBe('auto')
    expect(() => parseAssistantPermissionMode(undefined)).toThrow('PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_REQUIRED')
    expect(() => parseAssistantPermissionMode('fast')).toThrow('PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_INVALID')
  })

  it('requires approval for normal operations in ask mode regardless of operation risk', () => {
    expect(shouldRequireAssistantToolApproval({
      mode: 'ask',
      operation: buildOperation('get_project_context'),
    })).toBe(true)
    expect(shouldRequireAssistantToolApproval({
      mode: 'ask',
      operation: makeTestOperation({
        id: 'generate_edit_script',
        intent: 'act',
        effects: EFFECTS_BILLABLE,
        confirmation: { required: true },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: async () => ({ ok: true }),
      }),
    })).toBe(true)
  })

  it('exempts human input operations from ask approval', () => {
    for (const operationId of [
      'ui_cancel',
      'ui_confirm',
      'ui_single_select',
      'ui_multi_select',
      'ui_safety_ack',
      'request_edit_first_choice',
    ]) {
      expect(shouldRequireAssistantToolApproval({
        mode: 'ask',
        operation: buildOperation(operationId),
      })).toBe(false)
    }
  })

  it('does not require assistant execution approval in auto mode', () => {
    expect(shouldRequireAssistantToolApproval({
      mode: 'auto',
      operation: buildOperation('generate_edit_script'),
    })).toBe(false)
  })
})
