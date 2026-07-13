import {
  describe,
  expect,
  it,
  resolveEditFirstWorkflowViewFromSnapshot,
  snapshot,
} from './edit-first-workflow.fixture'

describe('edit-first workflow state', () => {
  it('ingests source script first without generic execution confirmation', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot())

    expect(state.step).toBe('script_intake')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('ingest_script')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['ingest_script'])
  })

  it('separates prompt script expansion from episode plan generation', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'generating',
      sourceDocumentKind: 'prompt_generated_outline',
    }))

    expect(state.step).toBe('source_script')
    expect(state.status.kind).toBe('processing')
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })

  it('does not expose script ingestion after a confirmed script bible generation fails', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'failed',
      sourceDocumentKind: 'paste',
    }))

    expect(state.step).toBe('episode_plan')
    expect(state.status.kind).toBe('failed')
    expect(state.operationPolicy.recommendedAction).toBeNull()
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })

  it('routes style text and image generation through consecutive Task-backed operations', () => {
    const directionsReady = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
    }))
    expect(directionsReady.step).toBe('visual_style')
    expect(directionsReady.operationPolicy.recommendedAction?.operationId).toBe('generate_edit_style_previews')

    const directionsRunning = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      activeStylePreviewTaskCount: 1,
    }))
    expect(directionsRunning.step).toBe('visual_style')
    expect(directionsRunning.status.kind).toBe('processing')

    const plannedOnly = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 3,
      activeStylePreviewTaskCount: 0,
    }))
    expect(plannedOnly.step).toBe('visual_style')
    expect(plannedOnly.operationPolicy.recommendedAction?.operationId).toBe('generate_edit_style_preview_images')
    expect(plannedOnly.status.kind).not.toBe('processing')

    const submitted = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 3,
      activeStylePreviewTaskCount: 1,
    }))
    expect(submitted.step).toBe('visual_style')
    expect(submitted.status.kind).toBe('processing')
  })

  it('requires script review before generating the episode plan from a generated prompt script', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'script_ready_for_review',
      sourceDocumentKind: 'prompt_generated_script',
    }))

    expect(state.step).toBe('source_script')
    expect(state.status.kind).toBe('needs_user_choice')
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })

  it('generates the episode plan only after the generated script is approved', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'script_approved',
      sourceDocumentKind: 'prompt_generated_script',
    }))

    expect(state.step).toBe('episode_plan')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('generate_bible_from_script')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['generate_bible_from_script'])
  })

  it('goes from confirmed style bible to chapter planning', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 2,
      confirmedStylePreviewCount: 1,
    }))

    expect(state.step).toBe('chapter_plan')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('plan_chapters')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['plan_chapters'])
    expect(state.operationPolicy.allowedOperationIds).toEqual(['plan_chapters'])
  })

  it('treats submitted chapter planning tasks as an active edit-script generation edge', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      activeEditScriptTaskCount: 2,
    }))

    expect(state.step).toBe('chapter_plan')
    expect(state.status.kind).toBe('processing')
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })
})
