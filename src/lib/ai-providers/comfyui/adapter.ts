import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { buildMediaOptionSchema } from '@/lib/ai-providers/shared/option-schema'
import { readComfyUiBaseUrl } from './config'
import { runComfyUiAudioWorkflow, runComfyUiVideoWorkflow } from './client'

function describe(
  modality: 'video' | 'music' | 'voice',
  selection: Parameters<NonNullable<AiProviderAdapter['video']>['describe']>[0],
) {
  return describeMediaVariantBase({
    modality,
    selection,
    executionMode: 'sync',
    optionSchema: buildMediaOptionSchema(modality),
  })
}

export const comfyuiAdapter: AiProviderAdapter = {
  providerKey: 'comfyui',
  video: {
    describe: (selection) => describe('video', selection),
    execute: async (input) => {
      const output = await runComfyUiVideoWorkflow({
        baseUrl: readComfyUiBaseUrl(),
        workflowKey: input.selection.modelId,
        prompt: input.options?.prompt,
        firstFrameImageUrl: input.imageUrl,
        referenceImageUrls: input.options?.referenceImages,
        referenceAudioUrls: input.options?.referenceAudios,
        lastFrameImageUrl: input.options?.lastFrameImageUrl,
        durationSeconds: input.options?.duration,
        width: readDimension(input.options?.width),
        height: readDimension(input.options?.height),
      })
      return {
        success: true,
        videoUrl: output.videoUrl,
        metadata: { mimeType: output.mimeType, contentLength: output.contentLength },
      }
    },
  },
  music: {
    describe: (selection) => describe('music', selection),
    execute: async (input) => {
      const output = await runComfyUiAudioWorkflow({
        baseUrl: readComfyUiBaseUrl(),
        workflowKey: input.selection.modelId,
        prompt: input.prompt,
        negativePrompt: input.options?.negativePrompt,
        durationSeconds: input.options?.durationSeconds,
        referenceAudioUrls: input.options?.referenceVideoUrl ? [input.options.referenceVideoUrl] : undefined,
      })
      return {
        success: true,
        audioBase64: output.audioBase64,
        audioUrl: `data:${output.mimeType};base64,${output.audioBase64}`,
        audioMimeType: output.mimeType,
      }
    },
  },
  voice: {
    describe: (selection) => describe('voice', selection),
    execute: async (input) => {
      const output = await runComfyUiAudioWorkflow({
        baseUrl: readComfyUiBaseUrl(),
        workflowKey: input.selection.modelId,
        prompt: [input.description, input.text].filter(Boolean).join('\n\n'),
        negativePrompt: input.options?.language ? `language: ${input.options.language}` : undefined,
      })
      return {
        success: true,
        audioBase64: output.audioBase64,
        audioUrl: `data:${output.mimeType};base64,${output.audioBase64}`,
        audioMimeType: output.mimeType,
      }
    },
  },
}

function readDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
}
