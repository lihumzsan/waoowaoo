import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  it('does not render mutation batch undo controls for submitted task cards', () => {
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers.tsx'),
      'utf8',
    )
    const taskSubmittedCardSource = rendererSource.slice(
      rendererSource.indexOf('function TaskSubmittedDataCard'),
      rendererSource.indexOf('function TaskBatchSubmittedDataCard'),
    )
    const taskBatchSubmittedCardSource = rendererSource.slice(
      rendererSource.indexOf('function TaskBatchSubmittedDataCard'),
      rendererSource.indexOf('function isEditStylePreviewChoiceReady'),
    )

    expect(rendererSource).not.toContain('useRevertMutationBatch')
    expect(taskSubmittedCardSource).not.toContain('mutationBatchId')
    expect(taskBatchSubmittedCardSource).not.toContain('mutationBatchId')
    expect(taskSubmittedCardSource).not.toContain('undoCurrentChange')
    expect(taskBatchSubmittedCardSource).not.toContain('undoCurrentBatch')
  })
})
