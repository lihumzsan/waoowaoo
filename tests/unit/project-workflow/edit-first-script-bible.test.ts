import {
  describe,
  expect,
  it,
  resolveEditFirstWorkflowStateFromSnapshot,
  snapshot,
} from './edit-first-workflow.fixture'

describe('edit-first workflow state', () => {
  it('ingests source script first without generic execution confirmation', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot())

    expect(state.stage).toBe('ready_to_ingest_script')
    expect(state.nextAction?.operationId).toBe('ingest_script')
    expect(state.allowedOperationIds).toEqual(['ingest_script'])
  })

  it('separates prompt script expansion from episode plan generation', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'generating',
      sourceDocumentKind: 'prompt_generated_outline',
    }))

    expect(state.stage).toBe('script_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(state.allowedOperationIds).toEqual([])
  })

  it('does not expose script ingestion after a confirmed script bible generation fails', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'failed',
      sourceDocumentKind: 'paste',
    }))

    expect(state.stage).toBe('failed')
    expect(state.nextAction).toBeNull()
    expect(state.allowedOperationIds).toEqual([])
  })

  it('routes style text and image generation through consecutive Task-backed operations', () => {
    const directionsReady = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
    }))
    expect(directionsReady.stage).toBe('ready_to_generate_style_previews')
    expect(directionsReady.nextAction?.operationId).toBe('generate_edit_style_previews')

    const directionsRunning = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      activeStylePreviewTaskCount: 1,
    }))
    expect(directionsRunning.stage).toBe('style_preview_generating')
    expect(directionsRunning.blocking.kind).toBe('processing')

    const plannedOnly = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 3,
      activeStylePreviewTaskCount: 0,
    }))
    expect(plannedOnly.stage).toBe('ready_to_generate_style_previews')
    expect(plannedOnly.nextAction?.operationId).toBe('generate_edit_style_preview_images')
    expect(plannedOnly.blocking.kind).not.toBe('processing')

    const submitted = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 3,
      activeStylePreviewTaskCount: 1,
    }))
    expect(submitted.stage).toBe('style_preview_generating')
    expect(submitted.blocking.kind).toBe('processing')
  })

  it('requires script review before generating the episode plan from a generated prompt script', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'script_ready_for_review',
      sourceDocumentKind: 'prompt_generated_script',
    }))

    expect(state.stage).toBe('script_ready_for_review')
    expect(state.blocking.kind).toBe('needs_user_choice')
    expect(state.allowedOperationIds).toEqual([])
  })

  it('generates the episode plan only after the generated script is approved', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'script_approved',
      sourceDocumentKind: 'prompt_generated_script',
    }))

    expect(state.stage).toBe('ready_to_generate_bible')
    expect(state.nextAction?.operationId).toBe('generate_bible_from_script')
    expect(state.allowedOperationIds).toEqual(['generate_bible_from_script'])
  })

  it('goes from confirmed style bible to chapter planning', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 2,
      confirmedStylePreviewCount: 1,
    }))

    expect(state.stage).toBe('ready_to_generate_edit_script')
    expect(state.nextAction?.operationId).toBe('plan_chapters')
    expect(state.allowedOperationIds).toEqual(['plan_chapters'])
    expect(state.allowedOperationIds).toEqual(['plan_chapters'])
  })

  it('treats submitted chapter planning tasks as an active edit-script generation edge', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      activeEditScriptTaskCount: 2,
    }))

    expect(state.stage).toBe('edit_script_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(state.allowedOperationIds).toEqual([])
  })
})
