import {
  describe,
  expect,
  it,
  resolveEditFirstWorkflowStateFromSnapshot,
  snapshot,
} from './edit-first-workflow.fixture'

describe('edit-first workflow state', () => {
  it('recovers missing chapter planning when no planning task is active', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'pending',
      activeEditScriptTaskCount: 0,
    }))

    expect(state.stage).toBe('ready_to_generate_edit_script')
    expect(state.nextAction?.operationId).toBe('plan_chapters')
    expect(state.allowedOperationIds).toEqual(['plan_chapters'])
  })

  it('keeps chapter planning blocked while a missing chapter task is active', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'generating',
      activeEditScriptTaskCount: 1,
    }))

    expect(state.stage).toBe('edit_script_generating')
    expect(state.allowedOperationIds).toEqual([])
  })

  it('allows batch repair and explicit chapter repair after edit-script generation failure', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'failed',
    }))

    expect(state.stage).toBe('failed')
    expect(state.nextAction?.operationId).toBe('replan_chapter')
    expect(state.allowedOperationIds).toEqual(['replan_chapter', 'plan_chapters'])
  })

  it('waits for required assets and spatial profiles before shot execution planning', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
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

    expect(state.stage).toBe('assets_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(state.allowedOperationIds).toEqual([])
  })

  it('requires asset review before shot execution planning when reusable assets exist', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
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

    expect(state.stage).toBe('assets_ready_for_review')
    expect(state.blocking.kind).toBe('needs_user_choice')
    expect(state.allowedOperationIds).toEqual([])
  })

  it('generates shot execution plan after core plan, assets, and spatial profiles are ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
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

    expect(state.stage).toBe('ready_to_generate_shot_execution_plan')
    expect(state.nextAction?.operationId).toBe('generate_edit_shot_execution_plan')
    expect(state.allowedOperationIds).toEqual(['generate_edit_shot_execution_plan'])
  })

  it('recovers missing shot execution plans when no shot-plan task is active', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
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

    expect(state.stage).toBe('ready_to_generate_shot_execution_plan')
    expect(state.nextAction?.operationId).toBe('generate_edit_shot_execution_plan')
    expect(state.allowedOperationIds).toEqual(['generate_edit_shot_execution_plan'])
  })

  it('keeps shot execution planning blocked while a shot-plan task is active', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
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

    expect(state.stage).toBe('ready_to_generate_shot_execution_plan')
    expect(state.blocking.kind).toBe('processing')
    expect(state.allowedOperationIds).toEqual([])
  })
})
