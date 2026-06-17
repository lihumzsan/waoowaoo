import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { executeFalImageGeneration } from './image'
import { executeFalMusicGeneration } from './music'
import { resolveFalOptionSchema } from './models'
import { executeFalVideoGeneration } from './video'

function describeFalMediaVariant(
  modality: 'image' | 'video' | 'music',
  selection: Parameters<NonNullable<AiProviderAdapter['image']>['describe']>[0],
) {
  return describeMediaVariantBase({
    modality,
    selection,
    executionMode: modality === 'image' || modality === 'video' ? 'async' : 'sync',
    optionSchema: resolveFalOptionSchema(modality, selection.modelId),
  })
}

export const falAdapter: AiProviderAdapter = {
  providerKey: 'fal',
  image: {
    describe: (selection) => describeFalMediaVariant('image', selection),
    execute: executeFalImageGeneration,
  },
  video: {
    describe: (selection) => describeFalMediaVariant('video', selection),
    execute: executeFalVideoGeneration,
  },
  music: {
    describe: (selection) => describeFalMediaVariant('music', selection),
    execute: executeFalMusicGeneration,
  },
}
