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

  it('builds readiness from canonical panel sources without UI model state', async () => {
    const { buildFirstLastFramePromptSourceSignature } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const { buildFirstLastFramePromptFingerprintInput } = await import(
      '@/lib/novel-promotion/first-last-frame-prompt-fingerprint'
    )
    const firstPanel = {
      id: 'first',
      imageUrl: 'first.png',
      videoPrompt: 'walk forward',
      duration: 6,
    }
    const lastPanel = {
      id: 'last',
      imageUrl: 'last.png',
      videoPrompt: 'stop by the door',
    }

    expect(buildFirstLastFramePromptSourceSignature(firstPanel, lastPanel)).toBe(JSON.stringify({
      canonical: buildFirstLastFramePromptFingerprintInput({ firstPanel, lastPanel }),
    }))
    expect(buildFirstLastFramePromptSourceSignature(
      { ...firstPanel, videoPrompt: 'turn around' },
      lastPanel,
    )).not.toBe(buildFirstLastFramePromptSourceSignature(firstPanel, lastPanel))
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
      ready: true,
    }

    expect(buildFirstLastFrameVideoPrompt(entry)).toEqual({
      customPrompt: 'Visible transition prompt',
      customPromptEditedByUser: true,
    })
  })

  it('marks a saved manual prompt ready for the current source without queueing regeneration', async () => {
    const { markSavedUserPromptReady, resolvePromptEntryReadiness } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const saved = markSavedUserPromptReady({
      value: 'old prompt',
      origin: 'generated',
      dirty: true,
      status: 'saving',
      ready: false,
    }, 'new manual prompt', 'source-v2')

    expect(resolvePromptEntryReadiness(saved, 'source-v2')).toMatchObject({
      value: 'new manual prompt',
      origin: 'user',
      dirty: false,
      status: 'idle',
      ready: true,
      verifiedSourceSignature: 'source-v2',
    })
  })

  it('is pending on the first render until the current source has been verified', async () => {
    const { resolvePromptEntryReadiness } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const persisted = {
      value: 'Persisted prompt',
      origin: 'generated' as const,
      dirty: false,
      status: 'idle' as const,
      sourceFingerprint: 'server-fingerprint',
      ready: false,
    }

    expect(resolvePromptEntryReadiness(persisted, 'source-v2')).toMatchObject({
      status: 'queued',
      ready: false,
    })
    expect(resolvePromptEntryReadiness({
      ...persisted,
      ready: true,
      verifiedSourceSignature: 'source-v2',
    }, 'source-v2')).toMatchObject({ status: 'idle', ready: true })
  })

  it('keeps the operation gate startable while the derived view is pending', async () => {
    const { canStartPromptOperation, resolvePromptEntryReadiness } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const operationEntry = {
      value: 'Persisted prompt',
      origin: 'generated' as const,
      dirty: false,
      status: 'idle' as const,
      ready: false,
    }

    expect(resolvePromptEntryReadiness(operationEntry, 'source-v2').status).toBe('queued')
    expect(canStartPromptOperation(operationEntry)).toBe(true)
  })

  it('persists supported duration before using it for prompt and video generation', async () => {
    const { resolveFirstLastFrameDurationSelection } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    expect(resolveFirstLastFrameDurationSelection('duration', '6', { fps: 24 })).toEqual({
      binding: { mode: 'manual', voiceLineIds: [], targetDurationSeconds: 6, durationSource: 'manual' },
      generationOptions: { duration: 6, fps: 24 },
    })
    expect(resolveFirstLastFrameDurationSelection('duration', '16', {})).toBeNull()
  })

  it('persists every supported first-last-frame duration as a manual override', async () => {
    const { resolveFirstLastFrameDurationSelection } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    for (const duration of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      expect(resolveFirstLastFrameDurationSelection('duration', String(duration), { fps: 24 })).toEqual({
        binding: {
          mode: 'manual',
          voiceLineIds: [],
          targetDurationSeconds: duration,
          durationSource: 'manual',
        },
        generationOptions: { duration, fps: 24 },
      })
    }
  })

  it('isolates persisted duration selections between linked panels', async () => {
    const { resolvePanelFirstLastFrameGenerationOptions } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const defaults = { duration: 10, fps: 24 }
    const overrides = new Map([['panel-a', { duration: 4, fps: 24 }]])

    expect(resolvePanelFirstLastFrameGenerationOptions('panel-a', defaults, overrides).duration).toBe(4)
    expect(resolvePanelFirstLastFrameGenerationOptions('panel-b', defaults, overrides).duration).toBe(10)
  })

  it('restores each panel duration from its persisted binding after reload', async () => {
    const { resolvePanelFirstLastFrameGenerationOptions } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const defaults = { duration: 10, fps: 24 }
    const emptyOverrides = new Map<string, typeof defaults>()

    expect(resolvePanelFirstLastFrameGenerationOptions('panel-a', defaults, emptyOverrides, 4)).toEqual({
      duration: 4,
      fps: 24,
    })
    expect(resolvePanelFirstLastFrameGenerationOptions('panel-b', defaults, emptyOverrides)).toEqual(defaults)
  })

  it('uses smart recommendation as default unless a manual binding exists', async () => {
    const { resolvePanelFirstLastFrameGenerationOptions } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const defaults = { duration: 10, fps: 24 }
    const overrides = new Map<string, typeof defaults>()

    expect(resolvePanelFirstLastFrameGenerationOptions(
      'panel-a',
      defaults,
      overrides,
      {
        mode: 'manual',
        targetDurationSeconds: 8,
        durationSource: 'smart',
        recommendationFingerprint: 'fp-1',
      },
    )).toEqual({ duration: 8, fps: 24 })
    expect(resolvePanelFirstLastFrameGenerationOptions(
      'panel-a',
      defaults,
      overrides,
      {
        mode: 'manual',
        targetDurationSeconds: 6,
        durationSource: 'manual',
        recommendationFingerprint: 'fp-1',
      },
    )).toEqual({ duration: 6, fps: 24 })
  })

  it('preserves smart recommendation metadata when the user manually overrides duration', async () => {
    const { resolveFirstLastFrameDurationSelection } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    expect(resolveFirstLastFrameDurationSelection('duration', '12', { fps: 24 }, {
      mode: 'manual',
      targetDurationSeconds: 8,
      durationSource: 'smart',
      recommendationConfidence: 0.86,
      recommendationReason: 'motion beat recommendation',
      recommendationFingerprint: 'smart-fp',
      recommendationAlgorithmVersion: 'v1',
    })).toEqual({
      binding: {
        mode: 'manual',
        voiceLineIds: [],
        targetDurationSeconds: 12,
        durationSource: 'manual',
        recommendedDurationSeconds: 8,
        recommendationConfidence: 0.86,
        recommendationReason: 'motion beat recommendation',
        recommendationFingerprint: 'smart-fp',
        recommendationAlgorithmVersion: 'v1',
      },
      generationOptions: { duration: 12, fps: 24 },
    })
  })

  it('restores a manual override back to the stored smart recommendation', async () => {
    const { restoreFirstLastFrameSmartDurationBinding } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    expect(restoreFirstLastFrameSmartDurationBinding({
      mode: 'manual',
      voiceLineIds: [],
      targetDurationSeconds: 12,
      durationSource: 'manual',
      recommendedDurationSeconds: 8,
      recommendationConfidence: 0.86,
      recommendationReason: 'motion beat recommendation',
      recommendationFingerprint: 'smart-fp',
      recommendationAlgorithmVersion: 'v1',
    })).toEqual({
      mode: 'manual',
      voiceLineIds: [],
      targetDurationSeconds: 8,
      durationSource: 'smart',
      recommendedDurationSeconds: 8,
      recommendationConfidence: 0.86,
      recommendationReason: 'motion beat recommendation',
      recommendationFingerprint: 'smart-fp',
      recommendationAlgorithmVersion: 'v1',
    })

    expect(restoreFirstLastFrameSmartDurationBinding({
      mode: 'manual',
      voiceLineIds: [],
      targetDurationSeconds: 12,
      durationSource: 'manual',
    })).toBeNull()
  })

  it('does not re-ensure the first-last prompt for duration-only binding changes', async () => {
    const { shouldEnsurePromptAfterDurationSelection } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    expect(shouldEnsurePromptAfterDurationSelection({
      previousBinding: {
        mode: 'manual',
        targetDurationSeconds: 8,
        durationSource: 'smart',
        recommendationFingerprint: 'smart-fp',
      },
      nextBinding: {
        mode: 'manual',
        targetDurationSeconds: 12,
        durationSource: 'manual',
        recommendedDurationSeconds: 8,
        recommendationFingerprint: 'smart-fp',
      },
    })).toBe(false)
    expect(shouldEnsurePromptAfterDurationSelection({
      previousBinding: {
        mode: 'manual',
        targetDurationSeconds: 12,
        durationSource: 'manual',
        recommendedDurationSeconds: 8,
        recommendationFingerprint: 'smart-fp',
      },
      nextBinding: {
        mode: 'manual',
        targetDurationSeconds: 12,
        durationSource: 'manual',
        recommendedDurationSeconds: 8,
        recommendationFingerprint: 'smart-fp',
      },
    })).toBe(false)
  })

  it('keeps a verified first-last prompt ready after duration-only persistence', async () => {
    const { confirmDurationPersistenceForPromptEntry } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    expect(confirmDurationPersistenceForPromptEntry({
      entry: {
        value: 'generated first-last prompt',
        origin: 'generated',
        dirty: false,
        status: 'saving',
        ready: false,
        verifiedSourceSignature: 'source-v1',
      },
      currentSourceSignature: 'source-v1',
    })).toMatchObject({
      status: 'idle',
      ready: true,
      verifiedSourceSignature: 'source-v1',
      errorMessage: undefined,
    })

    expect(confirmDurationPersistenceForPromptEntry({
      entry: {
        value: 'generated first-last prompt',
        origin: 'generated',
        dirty: false,
        status: 'saving',
        ready: false,
        verifiedSourceSignature: 'source-v1',
      },
      currentSourceSignature: 'source-v2',
    })).toMatchObject({
      status: 'idle',
      ready: false,
      verifiedSourceSignature: undefined,
      errorMessage: undefined,
    })
  })

  it('builds a local smart binding from prompt-task smart duration unless manual already owns the panel', async () => {
    const {
      buildFirstLastFrameSmartDurationBinding,
      shouldApplyFirstLastFrameSmartDurationBinding,
    } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    const smartBinding = buildFirstLastFrameSmartDurationBinding({
      durationSeconds: 9,
      confidence: 0.82,
      reason: 'camera and character motion need pacing',
      fingerprint: 'smart-fp',
      algorithmVersion: 'v1',
    })

    expect(smartBinding).toEqual({
      mode: 'manual',
      voiceLineIds: [],
      targetDurationSeconds: 9,
      recommendedDurationSeconds: 9,
      durationSource: 'smart',
      recommendationConfidence: 0.82,
      recommendationReason: 'camera and character motion need pacing',
      recommendationFingerprint: 'smart-fp',
      recommendationAlgorithmVersion: 'v1',
    })
    expect(shouldApplyFirstLastFrameSmartDurationBinding(null)).toBe(true)
    expect(shouldApplyFirstLastFrameSmartDurationBinding({ durationSource: 'smart', targetDurationSeconds: 8 })).toBe(true)
    expect(shouldApplyFirstLastFrameSmartDurationBinding({ durationSource: 'manual', targetDurationSeconds: 6 })).toBe(false)
  })

  it('describes the first-last duration source for UI status and restore affordance', async () => {
    const { resolveFirstLastFrameDurationStatus } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    expect(resolveFirstLastFrameDurationStatus({
      binding: {
        durationSource: 'smart',
        targetDurationSeconds: 9,
        recommendationReason: 'motion requires a slower bridge',
      },
      durationSeconds: 9,
    })).toEqual({
      source: 'smart',
      durationSeconds: 9,
      reason: 'motion requires a slower bridge',
      canRestoreSmart: false,
    })
    expect(resolveFirstLastFrameDurationStatus({
      binding: {
        durationSource: 'manual',
        targetDurationSeconds: 6,
        recommendedDurationSeconds: 9,
        recommendationFingerprint: 'smart-fp',
      },
      durationSeconds: 6,
    })).toEqual({
      source: 'manual',
      durationSeconds: 6,
      canRestoreSmart: true,
    })
    expect(resolveFirstLastFrameDurationStatus({
      binding: null,
      durationSeconds: 10,
      promptStatus: 'processing',
    })).toEqual({
      source: 'analyzing',
      durationSeconds: 10,
      canRestoreSmart: false,
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
      appliedSignature?: string,
    ) => boolean
    expect(isCurrent('source-a', 'source-b')).toBe(false)
    expect(isCurrent('source-b', 'source-b')).toBe(true)
    expect(isCurrent('source-before-smart-duration', 'source-after-smart-duration', 'source-after-smart-duration')).toBe(true)
    expect(isCurrent('source-before-smart-duration', 'unrelated-source-change', 'source-after-smart-duration')).toBe(false)
  })

  it('restores a superseded queued entry so relinking can start a new ensure', async () => {
    const promptState = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    ) as Record<string, unknown>

    expect(typeof promptState.clearSupersededPromptOperation).toBe('function')
    if (typeof promptState.clearSupersededPromptOperation !== 'function') return
    const clear = promptState.clearSupersededPromptOperation as (entry: {
      value: string
      origin: 'generated'
      dirty: boolean
      status: 'queued'
      errorMessage?: string
    }) => { status: string; errorMessage?: string }
    const cleared = clear({
      value: 'Keep current text',
      origin: 'generated',
      dirty: false,
      status: 'queued',
      errorMessage: 'old error',
    })

    expect(cleared).toMatchObject({ value: 'Keep current text', status: 'idle' })
    expect(cleared.errorMessage).toBeUndefined()
    expect((promptState.canStartPromptOperation as (entry: { status: string }) => boolean)(cleared)).toBe(true)
  })

  it('projects worker processing while protecting locally settled authority from stale active snapshots', async () => {
    const promptState = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    ) as Record<string, unknown>

    expect(typeof promptState.shouldProjectPromptTaskSnapshot).toBe('function')
    if (typeof promptState.shouldProjectPromptTaskSnapshot !== 'function') return
    const shouldProject = promptState.shouldProjectPromptTaskSnapshot as (params: {
      localOperationActive: boolean
      ignoreActiveSnapshot: boolean
      taskPhase?: string | null
    }) => boolean
    expect(shouldProject({
      localOperationActive: true,
      ignoreActiveSnapshot: false,
      taskPhase: 'processing',
    })).toBe(true)
    expect(shouldProject({
      localOperationActive: true,
      ignoreActiveSnapshot: false,
      taskPhase: 'completed',
    })).toBe(false)
    expect(shouldProject({
      localOperationActive: false,
      ignoreActiveSnapshot: true,
      taskPhase: 'processing',
    })).toBe(false)
    expect(shouldProject({
      localOperationActive: false,
      ignoreActiveSnapshot: true,
      taskPhase: 'completed',
    })).toBe(true)
  })

  it('clears recovered active status when the authoritative target becomes completed or idle', async () => {
    const { projectPromptTaskState } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )
    const processing = {
      value: 'Current text',
      origin: 'generated' as const,
      dirty: false,
      status: 'processing' as const,
    }

    expect(projectPromptTaskState(processing, { phase: 'completed' }).status).toBe('idle')
    expect(projectPromptTaskState(processing, { phase: 'idle' }).status).toBe('idle')
  })

  it('allows the latest source ensure while an older processing snapshot is intentionally ignored', async () => {
    const { shouldAutoEnsurePrompt } = await import(
      '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
    )

    expect(shouldAutoEnsurePrompt({
      taskHydrated: true,
      taskPhase: 'processing',
      ignoreActiveSnapshot: true,
    })).toBe(true)
  })
})
