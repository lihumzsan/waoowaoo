import {
  buildWorkspaceCanvasFocusKey,
  describe,
  expect,
  it,
  resolveCanvasFocusFollowDecision,
} from './canvas-focus-follow.fixture'

describe('workspace canvas focus follow', () => {
  it('uses the explicit request key so the same style bible card can be refocused', () => {
    const nodeIds = ['edit-style-bible:bible-1']

    expect(buildWorkspaceCanvasFocusKey(nodeIds, 'style-bible-confirmed:1'))
      .toBe('style-bible-confirmed:1:edit-style-bible:bible-1')
    expect(resolveCanvasFocusFollowDecision({
      focusKey: buildWorkspaceCanvasFocusKey(nodeIds, 'style-bible-confirmed:2'),
      enabled: true,
      manualPauseActive: false,
      lastFocusedKey: buildWorkspaceCanvasFocusKey(nodeIds, 'style-bible-confirmed:1'),
    })).toBe('focus')
  })

  it('uses operation request keys so the same running card can refocus on a later run', () => {
    const nodeIds = ['edit-script:script-1']

    expect(buildWorkspaceCanvasFocusKey(nodeIds, 'run-1:generate_edit_script'))
      .toBe('run-1:generate_edit_script:edit-script:script-1')
    expect(resolveCanvasFocusFollowDecision({
      focusKey: buildWorkspaceCanvasFocusKey(nodeIds, 'run-2:generate_edit_script'),
      enabled: true,
      manualPauseActive: false,
      lastFocusedKey: buildWorkspaceCanvasFocusKey(nodeIds, 'run-1:generate_edit_script'),
    })).toBe('focus')
  })

  it('does not refocus the same running group after it has already focused', () => {
    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-1',
      enabled: true,
      manualPauseActive: false,
      lastFocusedKey: 'shot:panel-1',
    })).toBe('skip_already_focused')
  })

  it('keeps focus pending while user interaction pause is active', () => {
    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-1',
      enabled: true,
      manualPauseActive: true,
      lastFocusedKey: null,
    })).toBe('pending')
  })

  it('does not refocus the same request after user interaction pause expires', () => {
    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-1',
      enabled: true,
      manualPauseActive: false,
      lastFocusedKey: 'shot:panel-1',
    })).toBe('skip_already_focused')
  })

  it('keeps focus pending while auto follow is disabled', () => {
    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-1',
      enabled: false,
      manualPauseActive: false,
      lastFocusedKey: null,
    })).toBe('pending')
  })
})
