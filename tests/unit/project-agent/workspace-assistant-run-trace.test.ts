import { describe, expect, it } from 'vitest'
import {
  groupWorkspaceAssistantMessageParts,
  resolveWorkspaceAssistantRunTraceView,
  WORKSPACE_ASSISTANT_RUN_TRACE_GROUP_KEY,
} from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-run-trace'

describe('workspace assistant run trace view', () => {
  it('keeps the generic wait state until real visible content arrives', () => {
    const waitingParts = [
      { type: 'data', name: 'agent-run', data: { status: 'running' } },
      { type: 'data', name: 'agent-runtime-context', data: {} },
      { type: 'reasoning', text: '' },
    ]
    const waitingView = resolveWorkspaceAssistantRunTraceView(waitingParts)

    expect(waitingView).toMatchObject({
      hasPublicReasoning: false,
      hasVisibleContent: false,
      visibleToolCallCount: 0,
      traceIndices: [],
    })
    expect(groupWorkspaceAssistantMessageParts(waitingParts)).toEqual([
      { groupKey: undefined, indices: [0] },
      { groupKey: undefined, indices: [1] },
      { groupKey: undefined, indices: [2] },
    ])

    expect(resolveWorkspaceAssistantRunTraceView([
      ...waitingParts,
      { type: 'text', text: 'Direct answer' },
    ])).toMatchObject({
      hasPublicReasoning: false,
      hasVisibleContent: true,
    })

    expect(resolveWorkspaceAssistantRunTraceView([
      ...waitingParts,
      {
        type: 'tool-call',
        toolCallId: 'tool-1',
        toolName: 'get_task',
      },
    ])).toMatchObject({
      hasPublicReasoning: false,
      hasVisibleContent: true,
      visibleToolCallCount: 1,
    })

    expect(resolveWorkspaceAssistantRunTraceView([
      ...waitingParts,
      {
        type: 'data',
        name: 'assistant-resource-links',
        data: { resources: [{ resourceId: 'resource-1' }] },
      },
    ])).toMatchObject({
      hasPublicReasoning: false,
      hasVisibleContent: true,
    })
  })

  it('groups reasoning, tool calls, and pre-tool commentary once in source order', () => {
    const runningParts = [
      { type: 'data', name: 'agent-run', data: { status: 'running' } },
      { type: 'data', name: 'agent-runtime-context', data: {} },
      { type: 'reasoning', text: 'Choose the task to inspect.' },
      { type: 'text', text: 'I will check the task now.' },
      {
        type: 'tool-call',
        toolCallId: 'tool-read',
        toolName: 'get_task',
      },
      { type: 'data', name: 'agent-activity', data: { status: 'completed' } },
      { type: 'reasoning', text: 'The task is complete; summarize it.' },
      { type: 'text', text: 'Final answer' },
      {
        type: 'tool-call',
        toolCallId: 'tool-plan',
        toolName: 'update_plan',
      },
    ]

    expect(resolveWorkspaceAssistantRunTraceView(runningParts)).toMatchObject({
      hasPublicReasoning: true,
      visibleToolCallCount: 1,
      traceIndices: [],
    })
    expect(groupWorkspaceAssistantMessageParts(runningParts)).toEqual(
      runningParts.map((_part, index) => ({
        groupKey: undefined,
        indices: [index],
      })),
    )

    const parts = [
      ...runningParts,
      { type: 'data', name: 'agent-run', data: { status: 'completed' } },
    ]

    expect(resolveWorkspaceAssistantRunTraceView(parts)).toEqual({
      hasPublicReasoning: true,
      hasVisibleContent: true,
      visibleToolCallCount: 1,
      traceAnchorIndex: 0,
      traceIndices: [0, 2, 3, 4, 6, 8],
    })
    expect(groupWorkspaceAssistantMessageParts(parts)).toEqual([
      {
        groupKey: WORKSPACE_ASSISTANT_RUN_TRACE_GROUP_KEY,
        indices: [0, 2, 3, 4, 6, 8],
      },
      { groupKey: undefined, indices: [1] },
      { groupKey: undefined, indices: [5] },
      { groupKey: undefined, indices: [7] },
      { groupKey: undefined, indices: [9] },
    ])
  })

  it('counts visible tool attempts by opaque toolCallId', () => {
    const view = resolveWorkspaceAssistantRunTraceView([
      { type: 'data', name: 'agent-run', data: { status: 'running' } },
      { type: 'reasoning', text: 'Use the available tools.' },
      { type: 'tool-call', toolCallId: 'tool-a', toolName: 'get_task' },
      { type: 'tool-call', toolCallId: 'tool-a', toolName: 'get_task' },
      { type: 'tool-call', toolCallId: 'tool-b', toolName: 'delegate_creative_work' },
      { type: 'tool-call', toolCallId: 'tool-internal', toolName: 'update_plan' },
    ])

    expect(view.visibleToolCallCount).toBe(2)
  })
})
