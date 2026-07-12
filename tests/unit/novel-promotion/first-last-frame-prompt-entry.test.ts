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

  it('blocks ensure and save while another prompt operation is active', async () => {
    const promptState = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    ) as Record<string, unknown>

    expect(typeof promptState.canStartPromptOperation).toBe('function')
    if (typeof promptState.canStartPromptOperation !== 'function') return
    const canStart = promptState.canStartPromptOperation as (entry: { status: string } | undefined) => boolean
    expect(canStart({ status: 'queued' })).toBe(false)
    expect(canStart({ status: 'processing' })).toBe(false)
    expect(canStart({ status: 'saving' })).toBe(false)
    expect(canStart({ status: 'idle' })).toBe(true)
    expect(canStart({ status: 'error' })).toBe(true)
  })

  it('does not auto ensure before task hydration or after a recovered failure', async () => {
    const promptState = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    ) as Record<string, unknown>

    expect(typeof promptState.shouldAutoEnsurePrompt).toBe('function')
    if (typeof promptState.shouldAutoEnsurePrompt !== 'function') return
    const shouldEnsure = promptState.shouldAutoEnsurePrompt as (params: {
      taskHydrated: boolean
      taskPhase?: string | null
    }) => boolean
    expect(shouldEnsure({ taskHydrated: false })).toBe(false)
    expect(shouldEnsure({ taskHydrated: true, taskPhase: 'failed' })).toBe(false)
    expect(shouldEnsure({ taskHydrated: true, taskPhase: 'queued' })).toBe(false)
    expect(shouldEnsure({ taskHydrated: true, taskPhase: 'processing' })).toBe(false)
    expect(shouldEnsure({ taskHydrated: true, taskPhase: 'idle' })).toBe(true)
  })

  it('turns an unapplied result into a retryable error instead of a permanent idle skip', async () => {
    const { applyPromptResult } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const entry = {
      value: 'Current text',
      origin: 'generated' as const,
      dirty: false,
      status: 'queued' as const,
    }

    expect(applyPromptResult(entry, {
      prompt: 'Stale result',
      sourceFingerprint: 'fingerprint-stale',
      applied: false,
      fallbackUsed: false,
      warnings: [],
    })).toMatchObject({
      value: 'Current text',
      status: 'error',
    })
  })

  it('rejects a completed result when the canonical source changed while it was active', async () => {
    const promptState = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    ) as Record<string, unknown>

    expect(typeof promptState.isPromptResultCurrent).toBe('function')
    if (typeof promptState.isPromptResultCurrent !== 'function') return
    const isCurrent = promptState.isPromptResultCurrent as (
      requestSignature: string,
      currentSignature: string | undefined,
    ) => boolean
    expect(isCurrent('source-a', 'source-b')).toBe(false)
    expect(isCurrent('source-b', 'source-b')).toBe(true)
  })
})
