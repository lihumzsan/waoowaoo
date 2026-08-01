import type {
  CreativeResourceAlternativeGenerationCapability,
  CreativeResourceAlternativeMediaKind,
} from '@/lib/creative-resource/contracts'
import { createProjectAgentOperationRegistryForApi } from './registry'

export interface CanvasCreationActionView {
  readonly operationId: string
  readonly mediaKind: CreativeResourceAlternativeMediaKind
  readonly requestKind: CreativeResourceAlternativeGenerationCapability['requestKind']
  readonly alternatives: {
    readonly min: number
    readonly max: number
  }
  readonly inputLimits: {
    readonly durationSeconds: {
      readonly min: number
      readonly max: number
    } | null
    readonly promptMaxLength: number | null
    readonly previewTextMaxLength: number | null
  }
}

export interface CanvasActionCatalogView {
  readonly creation: readonly CanvasCreationActionView[]
}

const MEDIA_ORDER: Readonly<Record<CreativeResourceAlternativeMediaKind, number>> = {
  image: 0,
  video: 1,
  music: 2,
  voice: 3,
}

/**
 * Projects the production Operation registry into the only Canvas creation
 * capability catalog. The client never guesses support from operation ids,
 * media names, or file presence.
 */
export function readCanvasActionCatalogView(): CanvasActionCatalogView {
  const registry = createProjectAgentOperationRegistryForApi()
  const creation = Object.values(registry)
    .flatMap((operation): CanvasCreationActionView[] => {
      if (operation.resourceContract.kind !== 'resource') return []
      const capability = operation.resourceContract.alternativeGeneration
      if (!capability) return []
      return [{
        operationId: operation.id,
        mediaKind: capability.mediaKind,
        requestKind: capability.requestKind,
        alternatives: {
          min: capability.minCount,
          max: capability.maxCount,
        },
        inputLimits: {
          durationSeconds: capability.inputLimits?.durationSeconds ?? null,
          promptMaxLength: capability.inputLimits?.promptMaxLength ?? null,
          previewTextMaxLength: capability.inputLimits?.previewTextMaxLength ?? null,
        },
      }]
    })
    .sort((left, right) => (
      MEDIA_ORDER[left.mediaKind] - MEDIA_ORDER[right.mediaKind]
      || left.operationId.localeCompare(right.operationId)
    ))
  return { creation }
}
