import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { buildAssistantRuntimeTurnContext } from '@/lib/assistant-runtime/runtime-access'
import { COMFYUI_H3_MODEL_ID } from '@/lib/ai-providers/comfyui/models'
import {
  resolveProjectProductionCapabilities,
  type ProjectProductionContext,
} from '@/lib/project-production-context'
import type { ProjectModelConfig } from '@/lib/config-service'

describe('project production prompt profile context', () => {
  it('automatically injects the H3 profile into the Agent Turn context', () => {
    ensureAiCatalogsRegistered()
    const config: ProjectModelConfig = {
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      editModel: null,
      videoModel: `comfyui::${COMFYUI_H3_MODEL_ID}`,
      musicModel: null,
      soundModel: null,
      videoRatio: '9:16',
      videoVocalPerformanceMode: 'native_dialogue',
      capabilityDefaults: {},
      capabilityOverrides: {},
    }
    const capabilities = resolveProjectProductionCapabilities(config)
    expect(capabilities.video?.promptProfile).toBe('minimax_h3_multimodal_v3')
    expect(capabilities.video?.supportedInputModes).toEqual([
      'reference',
      'first_frame',
      'first_last_frame',
    ])

    const context: ProjectProductionContext = {
      schemaVersion: 9,
      version: 'contract-version',
      project: {
        projectId: 'project-1',
        name: 'H3 project',
        description: null,
        videoRatio: '9:16',
      videoResolution: '2mp',
        imageResolution: '1024x1024',
      },
      productionCapabilities: capabilities,
      productionDefaults: {
        video: { vocalPerformanceMode: 'native_dialogue' },
      },
    }

    expect(buildAssistantRuntimeTurnContext('zh', context)).toContain(
      '"promptProfile": "minimax_h3_multimodal_v3"',
    )
    expect(capabilities.video?.minSegmentDurationSeconds).toBe(4)
    expect(capabilities.video?.maxSegmentDurationSeconds).toBe(13)
    expect(capabilities.video?.allowedSegmentDurationsSeconds).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(capabilities.video?.segmentDurationPlans[0]).toEqual({
      requestedDurationSeconds: 4,
      promptEndSeconds: 4.458,
    })
    expect(capabilities.video?.segmentDurationPlans.find((plan) => (
      plan.requestedDurationSeconds === 8
    ))).toEqual({
      requestedDurationSeconds: 8,
      promptEndSeconds: 8,
    })
    expect(buildAssistantRuntimeTurnContext('zh', context)).toContain(
      '"promptEndSeconds": 4.458',
    )
    expect(buildAssistantRuntimeTurnContext('zh', context)).toContain(
      '"vocalPerformanceMode": "native_dialogue"',
    )
  })
})
