import { describe, expect, it } from 'vitest'
import { inspectWorkspaceCanvasMotionPresenceContract } from '../../../scripts/guards/canvas-motion-presence-contract-guard.mjs'

const valid = [
  'resolveWorkspaceCanvasMotionPresenceAction',
  'const presenceAction =',
  "presenceAction === 'show'",
  "presenceAction === 'hide'",
  "presenceAction !== 'schedule_exit'",
  'lastVisibleChildrenRef',
].join('\n')

describe('canvas motion presence contract guard', () => {
  it('accepts the shared idempotent presence transition', () => {
    expect(inspectWorkspaceCanvasMotionPresenceContract(valid)).toEqual([])
  })

  it('rejects restoring React children as self-updating component state', () => {
    expect(inspectWorkspaceCanvasMotionPresenceContract(`${valid}\nuseState<ReactNode>\nsetCachedChildren`)).toEqual([
      'motion presence restores React children as state: useState<ReactNode>',
      'motion presence restores React children as state: setCachedChildren',
    ])
  })
})
