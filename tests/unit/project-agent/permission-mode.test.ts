import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseAssistantPermissionMode, shouldRequireAssistantToolApproval } from '@/lib/project-agent/permission-mode'
import { EDIT_FIRST_CHOICE_OPERATION_IDS } from '@/lib/project-agent/edit-first-choice-tools'
import { EFFECTS_BILLABLE, EFFECTS_NONE, makeTestOperation } from '../../helpers/project-agent-operations'

function buildOperation(id: string) {
  return makeTestOperation({
    id,
    intent: 'query',
    effects: EFFECTS_NONE,
    confirmation: { kind: 'none', required: false },
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

  it('keeps approval off for low-risk operations in ask mode', () => {
    expect(
      shouldRequireAssistantToolApproval({
        mode: 'ask',
        operation: buildOperation('get_project_context'),
      }),
    ).toBe(false)
  })

  it('requires approval for confirmation-marked non-edit-first operations in ask mode', () => {
    expect(
      shouldRequireAssistantToolApproval({
        mode: 'ask',
        operation: makeTestOperation({
          id: 'generate_episode_videos',
          intent: 'act',
          effects: EFFECTS_BILLABLE,
          confirmation: { kind: 'billable_media', required: true },
          inputSchema: z.object({}),
          outputSchema: z.object({ ok: z.boolean() }),
          plan: async () => ({
            kind: 'task_submission',
            operationId: 'generate_episode_videos',
            projectId: 'project-1',
            userId: 'user-1',
            tasks: [],
          }),
          commit: async () => ({ ok: true }),
        }),
      }),
    ).toBe(true)
  })

  it('does not require approval for an edit-first text operation', () => {
    expect(
      shouldRequireAssistantToolApproval({
        mode: 'ask',
        operation: makeTestOperation({
          id: 'generate_edit_script',
          intent: 'act',
          effects: EFFECTS_NONE,
          confirmation: { kind: 'none', required: false },
          inputSchema: z.object({}),
          outputSchema: z.object({ ok: z.boolean() }),
          execute: async () => ({ ok: true }),
        }),
      }),
    ).toBe(false)
  })

  it('exempts edit-first choice operations from ask approval', () => {
    for (const operationId of EDIT_FIRST_CHOICE_OPERATION_IDS) {
      expect(
        shouldRequireAssistantToolApproval({
          mode: 'ask',
          operation: buildOperation(operationId),
        }),
      ).toBe(false)
    }
  })

  it('does not require assistant execution approval in auto mode', () => {
    expect(
      shouldRequireAssistantToolApproval({
        mode: 'auto',
        operation: buildOperation('generate_edit_script'),
      }),
    ).toBe(false)
  })
})
