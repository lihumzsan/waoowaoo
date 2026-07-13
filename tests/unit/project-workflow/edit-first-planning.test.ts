import {
  describe,
  expect,
  it,
  resolveEditFirstWorkflowViewFromSnapshot,
  snapshot,
} from './edit-first-workflow.fixture'

describe('edit-first workflow state', () => {
  it('declares core planning and planned asset generation as one parallel operation group', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      plannedAssetCount: 3,
      pendingPlannedAssetCount: 2,
    }))

    expect(state.step).toBe('chapter_plan')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['generate_edit_script_assets', 'plan_chapters'])
    expect(state.operationPolicy.group).toEqual({
      id: 'edit_first_core_and_planned_assets',
      operationIds: ['generate_edit_script_assets', 'plan_chapters'],
      approvalOperationIds: ['generate_edit_script_assets'],
    })
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
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('plan_chapters')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['plan_chapters'])
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
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
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
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('replan_chapter')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['replan_chapter', 'plan_chapters'])
  })

  it('waits for required assets and spatial profiles before shot execution planning', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      pendingAssetRequirementCount: 1,
      generatingAssetRequirementCount: 1,
      requiredLocationSpatialProfileCount: 1,
      readyLocationSpatialProfileCount: 0,
    }))

    expect(state.step).toBe('planned_assets')
    expect(state.status.kind).toBe('processing')
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
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
      requiredLocationSpatialProfileCount: 1,
      readyLocationSpatialProfileCount: 1,
    }))

    expect(state.step).toBe('planned_assets')
    expect(state.status.kind).toBe('needs_user_choice')
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })

  it('generates shot execution plan after core plan, assets, and spatial profiles are ready', () => {
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
      requiredLocationSpatialProfileCount: 1,
      readyLocationSpatialProfileCount: 1,
    }))

    expect(state.step).toBe('shot_execution')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('generate_edit_shot_execution_plan')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['generate_edit_shot_execution_plan'])
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
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('generate_edit_shot_execution_plan')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['generate_edit_shot_execution_plan'])
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
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })
})
