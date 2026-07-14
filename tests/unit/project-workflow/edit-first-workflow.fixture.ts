import { describe, expect, it } from 'vitest'

import {
  resolveEditFirstWorkflowViewFromSnapshot,
  type EditFirstWorkflowSnapshot,
} from '@/lib/project-workflow/edit-first-view'

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
    hasEditScript: false,
    activeEditScriptTaskCount: 0,
    editScriptStatus: null,
    editScriptAssetReviewStatus: null,
    editAssetRequirementCount: 0,
    pendingAssetRequirementCount: 0,
    generatingAssetRequirementCount: 0,
    hasShotExecutionPlan: false,
    activeShotExecutionPlanTaskCount: 0,
    shotExecutionPlanStatus: null,
    videoPlanSegmentCount: 0,
    completedVideoSegmentCount: 0,
    failedVideoSegmentCount: 0,
    activeVideoTaskCount: 0,
    chapterCount: 0,
    renderableChapterCount: 0,
    completedChapterRenderCount: 0,
    failedChapterRenderCount: 0,
    activeChapterRenderTaskCount: 0,
    audioDesignStatus: null,
    audioDesignHasPlan: false,
    audioDesignHasScore: false,
    audioDesignHasAmbience: false,
    activeAudioDesignPlanTaskCount: 0,
    bgmScoreStatus: null,
    bgmScoreHasMix: false,
    activeBgmScoreGenerationTaskCount: 0,
    ambientSoundStatus: null,
    ambientSoundHasMix: false,
    activeAmbientSoundGenerationTaskCount: 0,
    finalRenderStatus: null,
    finalRenderHasOutput: false,
    activeFinalRenderTaskCount: 0,
    ...overrides,
  }
}

export { describe, expect, it } from 'vitest'
export { resolveEditFirstWorkflowViewFromSnapshot } from '@/lib/project-workflow/edit-first-view'
export type { EditFirstWorkflowSnapshot } from '@/lib/project-workflow/edit-first-view'
export { snapshot }
