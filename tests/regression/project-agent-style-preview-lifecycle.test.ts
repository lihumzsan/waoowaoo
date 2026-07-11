import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import {  resolveEditFirstWorkflowStateFromSnapshot,
  type EditFirstWorkflowSnapshot,
} from '@/lib/project-workflow/edit-first'

function snapshot(overrides: Partial<EditFirstWorkflowSnapshot>): EditFirstWorkflowSnapshot {
  return {
    hasEpisode: true,
    hasBible: true,
    bibleStatus: 'ready_for_review',
    sourceDocumentKind: 'paste',
    stylePreviewCount: 0,
    completedStylePreviewCount: 0,
    confirmedStylePreviewCount: 0,
    failedStylePreviewCount: 0,
    activeStylePreviewTaskCount: 0,
    hasEditScript: false,
    activeEditScriptTaskCount: 0,
    editScriptStatus: null,
    editScriptAssetReviewStatus: null,
    editAssetRequirementCount: 0,
    pendingAssetRequirementCount: 0,
    generatingAssetRequirementCount: 0,
    requiredLocationSpatialProfileCount: 0,
    readyLocationSpatialProfileCount: 0,
    hasShotExecutionPlan: false,
    activeShotExecutionPlanTaskCount: 0,
    shotExecutionPlanStatus: null,
    storyboardCount: 0,
    storyboardPanelPromptFailed: false,
    activeStoryboardPanelTaskCount: 0,
    panelCount: 0,
    storyboardPanelImagePromptMissingCount: 0,
    storyboardPanelVideoPromptMissingCount: 0,
    storyboardPanelImageReadyCount: 0,
    storyboardPanelImageMissingCount: 0,
    storyboardPanelImageFailedCount: 0,
    activeStoryboardImageTaskCount: 0,
    videoPlanSegmentCount: 0,
    completedVideoSegmentCount: 0,
    failedVideoSegmentCount: 0,
    activeVideoTaskCount: 0,
    chapterCount: 0,
    renderableChapterCount: 0,
    completedChapterRenderCount: 0,
    failedChapterRenderCount: 0,
    activeChapterRenderTaskCount: 0,
    bgmScoreStatus: null,
    bgmScoreHasMix: false,
    activeBgmScoreTaskCount: 0,
    soundscapeStatus: null,
    soundscapeHasMix: false,
    soundscapeDecision: null,
    activeSoundscapeTaskCount: 0,
    finalRenderStatus: null,
    finalRenderHasOutput: false,
    activeFinalRenderTaskCount: 0,
    ...overrides,
  }
}

describe('regression - production plan to visual-style lifecycle', () => {
  it('does not authorize visual-style generation before production plan ratio confirmation', () => {
    const workflow = resolveEditFirstWorkflowStateFromSnapshot(snapshot({}))

    expect(workflow.stage).toBe('bible_ready_for_review')
    expect(workflow.allowedOperationIds).toEqual([])
    expect(workflow.nextAction).toBeNull()
  })

  it('routes confirmed production plans through the independent billable style operation', () => {
    const workflow = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      bibleStatus: 'confirmed',
    }))
    const operation = createProjectAgentOperationRegistry().generate_edit_style_previews

    expect(workflow.stage).toBe('ready_to_generate_style_previews')
    expect(workflow.nextAction).toEqual(expect.objectContaining({
      operationId: 'generate_edit_style_previews',
    }))
    expect(workflow.allowedOperationIds).toEqual(['generate_edit_style_previews'])
    expect(operation?.confirmation).toEqual(expect.objectContaining({
      kind: 'billable_media',
      required: true,
    }))
    expect(operation?.agentFlow).toEqual(expect.objectContaining({
      onTaskComplete: 'resume_agent',
    }))
  })

  it('declares style confirmation as one non-billable registry write after Choice', () => {
    const operation = createProjectAgentOperationRegistry().confirm_edit_style_preview

    expect(operation).toMatchObject({
      id: 'confirm_edit_style_preview',
      intent: 'act',
      channels: { tool: true, api: false },
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: false,
        externalSideEffects: false,
        longRunning: false,
      },
      confirmation: { kind: 'none', required: false },
    })
    expect(operation?.toolInputSchema.required).toEqual([])
  })
})
