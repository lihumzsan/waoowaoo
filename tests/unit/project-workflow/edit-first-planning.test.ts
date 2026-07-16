import {
  describe,
  expect,
  it,
  resolveEditFirstWorkflowViewFromSnapshot,
  snapshot,
} from './edit-first-workflow.fixture'

describe('edit-first workflow state', () => {
  it('finishes every chapter plan before required asset generation can begin', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
    }))

    expect(state.step).toBe('chapter_plan')
    expect(state.recommendation.recommendedAction?.operationId).toBe('plan_chapters')
  })

  it('recovers missing chapter planning when no planning task is active', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'pending',
      activeEditScriptTaskCount: 0,
    }))

    expect(state.step).toBe('chapter_plan')
    expect(state.recommendation.recommendedAction?.operationId).toBe('plan_chapters')
  })

  it('keeps chapter planning blocked while a missing chapter task is active', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'generating',
      activeEditScriptTaskCount: 1,
    }))

    expect(state.step).toBe('chapter_plan')
  })

  it('allows batch repair and explicit chapter repair after edit-script generation failure', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'failed',
    }))

    expect(state.step).toBe('chapter_plan')
    expect(state.status.kind).toBe('failed')
    expect(state.recommendation.recommendedAction?.operationId).toBe('replan_chapter')
  })

  it('waits for required asset images before shot execution planning', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      pendingAssetRequirementCount: 1,
      generatingAssetRequirementCount: 1,
    }))

    expect(state.step).toBe('planned_assets')
    expect(state.status.kind).toBe('processing')
  })

  it('requires asset review before shot execution planning when reusable assets exist', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      editScriptAssetReviewStatus: 'pending',
      editAssetRequirementCount: 2,
      pendingAssetRequirementCount: 0,
    }))

    expect(state.step).toBe('planned_assets')
    expect(state.status.kind).toBe('needs_user_choice')
  })

  it('generates the shot execution plan after the core plan and asset images are ready', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      editScriptAssetReviewStatus: 'approved',
      editAssetRequirementCount: 2,
      pendingAssetRequirementCount: 0,
    }))

    expect(state.step).toBe('shot_execution')
    expect(state.recommendation.recommendedAction?.operationId).toBe('generate_edit_shot_execution_plan')
  })

  it('recovers missing shot execution plans when no shot-plan task is active', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'pending',
      activeShotExecutionPlanTaskCount: 0,
    }))

    expect(state.step).toBe('shot_execution')
    expect(state.recommendation.recommendedAction?.operationId).toBe('generate_edit_shot_execution_plan')
  })

  it('keeps shot execution planning blocked while a shot-plan task is active', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'generating',
      activeShotExecutionPlanTaskCount: 1,
    }))

    expect(state.step).toBe('shot_execution')
    expect(state.status.kind).toBe('processing')
  })
})
