import { describe, expect, it } from 'vitest'

import {
  resolveEditFirstWorkflowStateFromSnapshot,
  type EditFirstWorkflowSnapshot,
} from '@/lib/project-workflow/edit-first'

function snapshot(overrides: Partial<EditFirstWorkflowSnapshot> = {}): EditFirstWorkflowSnapshot {
  return {
    hasEpisode: true,
    hasBible: false,
    bibleStatus: null,
    sourceDocumentKind: null,
    activeSourceScriptTaskCount: 0,
    activeBibleTaskCount: 0,
    stylePreviewCount: 0,
    completedStylePreviewCount: 0,
    confirmedStylePreviewCount: 0,
    failedStylePreviewCount: 0,
    activeStylePreviewTaskCount: 0,
    plannedAssetCount: 0,
    pendingPlannedAssetCount: 0,
    activePlannedAssetTaskCount: 0,
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
    bgmScoreHasPlan: false,
    bgmScoreHasMix: false,
    activeBgmScorePlanTaskCount: 0,
    activeBgmScoreGenerationTaskCount: 0,
    soundscapeStatus: null,
    soundscapeHasMix: false,
    soundscapeDecision: null,
    activeSoundscapePlanTaskCount: 0,
    activeSoundscapeGenerationTaskCount: 0,
    finalRenderStatus: null,
    finalRenderHasOutput: false,
    activeFinalRenderTaskCount: 0,
    ...overrides,
  }
}

export { describe, expect, it } from 'vitest'
export { resolveEditFirstWorkflowStateFromSnapshot } from '@/lib/project-workflow/edit-first'
export type { EditFirstWorkflowSnapshot } from '@/lib/project-workflow/edit-first'
export { snapshot }
