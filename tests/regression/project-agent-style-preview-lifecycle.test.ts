import { describe, expect, it } from 'vitest'
import { buildEditFirstAssistantChoiceCard } from '@/lib/project-agent/choice-card'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import {
  resolveEditFirstWorkflowCapabilityOperationIds,
  resolveEditFirstWorkflowStateFromSnapshot,
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
  it('does not authorize visual-style generation before production plan ratio confirmation', async () => {
    const workflow = resolveEditFirstWorkflowStateFromSnapshot(snapshot({}))
    const card = await buildEditFirstAssistantChoiceCard({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      workflow,
      choiceType: 'bible_review',
      toolCallId: 'tool-review-1',
    })

    expect(workflow.stage).toBe('bible_ready_for_review')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(workflow)).toEqual(['revise_bible'])
    expect(card.groups).toEqual([expect.objectContaining({
      key: 'aspectRatio',
      required: true,
    })])
    expect(card).not.toHaveProperty('operationPlan')
    expect(card.submit).toEqual({ kind: 'submit_tool_output' })
  })

  it('routes confirmed production plans through the independent billable style operation', () => {
    const workflow = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      bibleStatus: 'confirmed',
    }))
    const operation = createProjectAgentOperationRegistry().generate_edit_style_previews

    expect(workflow.stage).toBe('ready_to_generate_style_previews')
    expect(workflow.nextAction).toEqual(expect.objectContaining({
      operationId: 'generate_edit_style_previews',
      approvalKind: 'billable_media',
      requiresUserConfirmation: true,
    }))
    expect(resolveEditFirstWorkflowCapabilityOperationIds(workflow)).toEqual(['generate_edit_style_previews'])
    expect(operation?.confirmation).toEqual(expect.objectContaining({
      kind: 'billable_media',
      required: true,
    }))
    expect(operation?.agentFlow).toEqual(expect.objectContaining({
      onTaskComplete: 'await_user_choice',
    }))
  })
})
