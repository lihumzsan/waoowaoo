import { describe, expect, it } from 'vitest'
import {
  isWorkspaceAssistantToolDetailsOpen,
  setWorkspaceAssistantToolDetailsOpen,
} from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers'

describe('workspace assistant renderers', () => {
  it('keeps tool call detail expansion keyed by tool call id', () => {
    const toolCallId = 'tool-call-regression-expand'

    setWorkspaceAssistantToolDetailsOpen(toolCallId, false)
    expect(isWorkspaceAssistantToolDetailsOpen(toolCallId)).toBe(false)

    setWorkspaceAssistantToolDetailsOpen(toolCallId, true)
    expect(isWorkspaceAssistantToolDetailsOpen(toolCallId)).toBe(true)

    setWorkspaceAssistantToolDetailsOpen('tool-call-regression-other', true)
    expect(isWorkspaceAssistantToolDetailsOpen(toolCallId)).toBe(true)

    setWorkspaceAssistantToolDetailsOpen(toolCallId, false)
    expect(isWorkspaceAssistantToolDetailsOpen(toolCallId)).toBe(false)
  })
})
