import { describe, expect, it } from 'vitest'
import {
  resolveEditFirstWorkflowStateFromSnapshot,
  type EditFirstWorkflowSnapshot,
} from '@/lib/project-workflow/edit-first'

function snapshot(overrides: Partial<EditFirstWorkflowSnapshot> = {}): EditFirstWorkflowSnapshot {
  return {
    hasEpisode: true,
    hasScreenplay: false,
    screenplayStatus: null,
    stylePreviewCount: 0,
    completedStylePreviewCount: 0,
    confirmedStylePreviewCount: 0,
    failedStylePreviewCount: 0,
    hasDirectorDecoupage: false,
    directorDecoupageStatus: null,
    hasEditScript: false,
    editScriptStatus: null,
    pendingAssetRequirementCount: 0,
    hasCinematographyShotPlan: false,
    cinematographyShotPlanStatus: null,
    storyboardCount: 0,
    panelCount: 0,
    ...overrides,
  }
}

describe('edit-first workflow state', () => {
  it('requires screenplay review before style preview generation', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'screenplay_ready',
    }))

    expect(state.stage).toBe('screenplay_ready_for_review')
    expect(state.blocking.kind).toBe('needs_confirmation')
    expect(state.nextAction?.operationId).toBe('generate_edit_style_previews')
    expect(state.allowedOperationIds).toEqual(['generate_edit_style_previews', 'revise_edit_screenplay'])
  })

  it('blocks later operations while style preview images are generating', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'style_preview_generating',
      stylePreviewCount: 3,
      completedStylePreviewCount: 1,
    }))

    expect(state.stage).toBe('style_preview_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(state.nextAction).toBeNull()
    expect(state.allowedOperationIds).toEqual([])
  })

  it('requires user style choice before director decoupage', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'style_preview_ready',
      stylePreviewCount: 3,
      completedStylePreviewCount: 3,
    }))

    expect(state.stage).toBe('needs_style_choice')
    expect(state.blocking.kind).toBe('needs_user_choice')
    expect(state.nextAction).toBeNull()
    expect(state.allowedOperationIds).toEqual([])
  })

  it('allows only director decoupage after screenplay is ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      stylePreviewCount: 3,
      completedStylePreviewCount: 2,
      confirmedStylePreviewCount: 1,
    }))

    expect(state.stage).toBe('ready_to_generate_director_decoupage')
    expect(state.nextAction?.operationId).toBe('generate_edit_director_decoupage')
    expect(state.allowedOperationIds).toEqual(['generate_edit_director_decoupage'])
    expect(state.allowedOperationIds).not.toContain('revise_edit_screenplay')
  })

  it('moves to edit core table only after director decoupage is ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
    }))

    expect(state.stage).toBe('ready_to_generate_edit_script')
    expect(state.nextAction?.operationId).toBe('generate_edit_script')
    expect(state.allowedOperationIds).toEqual(['generate_edit_script'])
  })
})
