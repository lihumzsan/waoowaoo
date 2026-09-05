import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { listBuiltinCapabilityCatalog } from '@/lib/ai-registry/capabilities-catalog'
import { resolveProjectProductionCapabilities } from '@/lib/project-production-context'
import type { ProjectModelConfig } from '@/lib/config-service'

describe('project production prompt profile context', () => {
  it('projects a complete timing and continuation contract for every registered video mode', () => {
    ensureAiCatalogsRegistered()
    const entries = listBuiltinCapabilityCatalog().filter((entry) => entry.modelType === 'video')
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      const config: ProjectModelConfig = {
        analysisModel: null,
        characterModel: null,
        locationModel: null,
        editModel: null,
        videoModel: `${entry.provider}::${entry.modelId}`,
        musicModel: null,
        soundModel: null,
        videoRatio: '9:16',
        videoVocalPerformanceMode: 'native_dialogue',
        capabilityDefaults: {},
        capabilityOverrides: {},
      }
      const capabilities = resolveProjectProductionCapabilities(config)
      const video = capabilities.video
      expect(video).not.toBeNull()
      if (!video) throw new Error('VIDEO_CONTEXT_MISSING')
      const declared = entry.capabilities?.video
      expect(video.promptProfile).toBe(declared?.promptProfile)
      expect(video.supportedInputModes).toEqual(declared?.supportedInputModes)
      for (const inputMode of declared?.supportedInputModes ?? []) {
        for (const duration of video.allowedSegmentDurationsSeconds) {
          const plans = video.segmentDurationPlans.filter((plan) => (
            plan.inputMode === inputMode && plan.requestedDurationSeconds === duration
          ))
          expect(plans).toHaveLength(1)
          const plan = plans[0]
          expect(plan.expectedOutputDurationSeconds).toBeGreaterThanOrEqual(duration)
          expect(plan.promptEndSeconds - plan.promptStartSeconds).toBeCloseTo(plan.expectedOutputDurationSeconds, 2)
          if (video.promptProfile === 'minimax_h3_multimodal_v3') {
            // Protocol oracle: 24fps, 17n+5 frames, and 22 leading guide frames.
            const frames = Math.round(plan.promptEndSeconds * 24)
            expect(frames % 17).toBe(5)
            const guideFrames = inputMode === 'continuation' ? 22 : 0
            expect(plan.promptStartSeconds).toBeCloseTo(guideFrames / 24, 3)
            expect(plan.expectedOutputDurationSeconds).toBeCloseTo((frames - guideFrames) / 24, 3)
          }
        }
      }
      expect(video.continuationInput).toEqual(declared?.continuationInput ?? null)
    }
  })
})
