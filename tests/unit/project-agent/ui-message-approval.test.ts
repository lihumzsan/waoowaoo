import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  findLatestProjectAgentApprovalResponse,
  findPendingAgentInterruption,
  findPendingToolApprovalId,
  findRespondedAgentApprovalIds,
} from '@/lib/project-agent/ui-message-approval'

describe('findPendingToolApprovalId', () => {
  it('returns the latest pending approval id from assistant tool parts', () => {
    const messages = [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-generate_edit_script',
          toolCallId: 'tool-1',
          state: 'approval-requested',
          input: {},
          approval: { id: 'approval-1' },
        },
        {
          type: 'tool-generate_edit_script_assets',
          toolCallId: 'tool-2',
          state: 'approval-requested',
          input: {},
          approval: { id: 'approval-2' },
        },
      ],
    }] satisfies UIMessage[]

    expect(findPendingToolApprovalId(messages)).toBe('approval-2')
  })

  it('ignores approval responses because they already satisfy the SDK tool result chain', () => {
    const messages = [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-generate_edit_script',
          toolCallId: 'tool-1',
          state: 'approval-responded',
          input: {},
          approval: { id: 'approval-1', approved: false, reason: 'user_interrupted' },
        },
      ],
    }] satisfies UIMessage[]

    expect(findPendingToolApprovalId(messages)).toBeNull()
  })

  it('prefers the latest Agents SDK interruption data part', () => {
    const messages = [{
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'data-agent-interruption',
          data: {
            requestId: 'req-1',
            approvalId: 'approval-1',
            operationId: 'generate_edit_script',
            runState: 'serialized-state',
            toolCallId: 'tool-call-1',
            display: {
              title: 'generate_edit_script',
              description: 'Generate edit script',
            },
          },
        },
      ],
    }] satisfies UIMessage[]

    expect(findPendingToolApprovalId(messages)).toBe('approval-1')
    expect(findPendingAgentInterruption(messages, 'approval-1')).toEqual({
      requestId: 'req-1',
      approvalId: 'approval-1',
      operationId: 'generate_edit_script',
      runState: 'serialized-state',
      toolCallId: 'tool-call-1',
      display: {
        title: 'generate_edit_script',
        description: 'Generate edit script',
      },
    })
  })

  it('extracts the latest hidden approval resume payload from user metadata', () => {
    const messages = [{
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Tool approval accepted.' }],
      metadata: {
        custom: {
          workspaceAssistantHidden: true,
          projectAgentApprovalResponse: {
            approvalId: 'approval-1',
            approved: true,
            runState: 'serialized-state',
            operationId: 'generate_edit_screenplay',
          },
        },
      },
    }] satisfies UIMessage[]

    expect(findLatestProjectAgentApprovalResponse(messages)).toEqual({
      approvalId: 'approval-1',
      approved: true,
      runState: 'serialized-state',
      operationId: 'generate_edit_screenplay',
      reason: null,
    })
  })

  it('does not treat an already responded Agents SDK interruption as pending', () => {
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'data-agent-interruption',
            data: {
              requestId: 'req-1',
              approvalId: 'approval-1',
              operationId: 'generate_edit_screenplay',
              runState: 'serialized-state',
              toolCallId: 'tool-call-1',
              display: {
                title: '生成剧本',
                description: 'Generate screenplay',
              },
            },
          },
        ],
      },
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Tool approval accepted.' }],
        metadata: {
          custom: {
            workspaceAssistantHidden: true,
            projectAgentApprovalResponse: {
              approvalId: 'approval-1',
              approved: true,
              runState: 'serialized-state',
              operationId: 'generate_edit_screenplay',
            },
          },
        },
      },
    ] satisfies UIMessage[]

    expect(findRespondedAgentApprovalIds(messages).has('approval-1')).toBe(true)
    expect(findPendingToolApprovalId(messages)).toBeNull()
  })
})
