import { describe, expect, it } from 'vitest'

describe('first/last-frame prompt entry', () => {
  it('does not create an authoritative empty entry for an absent persisted prompt', async () => {
    const promptState = await import('@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry').catch(() => null)

    expect(promptState).not.toBeNull()
    expect(promptState!.createPersistedPromptEntry({
      prompt: null,
      editedByUser: false,
      sourceFingerprint: null,
    })).toBeUndefined()
  })

  it('uses the same displayed entry value and edited flag in the video request', async () => {
    const { buildFirstLastFrameVideoPrompt } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const entry = {
      value: 'Visible transition prompt',
      origin: 'user' as const,
      dirty: false,
      status: 'idle' as const,
    }

    expect(buildFirstLastFrameVideoPrompt(entry)).toEqual({
      customPrompt: 'Visible transition prompt',
      customPromptEditedByUser: true,
    })
  })

  it('replaces user text when the source signature changes', async () => {
    const { markPromptSourceChanged } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    expect(markPromptSourceChanged({
      value: 'Old user text',
      origin: 'user',
      dirty: false,
      status: 'idle',
      sourceFingerprint: 'old-signature',
    }, 'new-signature')).toMatchObject({
      value: '',
      origin: 'derived',
      status: 'queued',
      sourceFingerprint: 'new-signature',
    })
  })

  it('ignores a late result after unlink or a newer request revision', async () => {
    const { shouldApplyPromptResult } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    expect(shouldApplyPromptResult({ linked: false, requestRevision: 2, currentRevision: 2 })).toBe(false)
    expect(shouldApplyPromptResult({ linked: true, requestRevision: 1, currentRevision: 2 })).toBe(false)
    expect(shouldApplyPromptResult({ linked: true, requestRevision: 2, currentRevision: 2 })).toBe(true)
  })

  it('projects task failure without losing text and makes fallback results retryable', async () => {
    const { projectPromptTaskState, applyPromptResult } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const current = {
      value: 'Keep this transition',
      origin: 'generated' as const,
      dirty: false,
      status: 'idle' as const,
    }

    expect(projectPromptTaskState(current, { phase: 'failed', errorMessage: 'vision failed' })).toMatchObject({
      value: 'Keep this transition',
      status: 'error',
      errorMessage: 'vision failed',
    })
    expect(applyPromptResult(current, {
      prompt: 'Deterministic fallback',
      sourceFingerprint: 'fingerprint-1',
      applied: true,
      fallbackUsed: true,
      warnings: ['fallback'],
    })).toMatchObject({
      value: 'Deterministic fallback',
      status: 'idle',
      fallbackUsed: true,
    })
  })
})
