import {
  normalizeToBase64ForGeneration,
  OutboundImageNormalizeError,
  resolveOwnedImageDataUrlForGeneration,
} from '@/lib/media/outbound-image'
import type {
  AiProviderImageExecutionContext,
  AiProviderPreparedMediaExecution,
} from '@/lib/ai-providers/runtime-types'
import {
  prepareCodexImageGenerationExecution,
  prepareCodexImageInputs,
} from './client'
import { CODEX_DEFAULT_IMAGE_MODEL_ID, CODEX_DEFAULT_MODEL_ID } from './constants'
import { createScopedLogger } from '@/lib/logging/core'

const codexImageLogger = createScopedLogger({ module: 'ai-provider.codex.image' })

async function cleanupReferencesAfterPreparationFailure(
  cleanup: (() => Promise<void>) | undefined,
): Promise<void> {
  if (!cleanup) return
  try {
    await cleanup()
  } catch (error) {
    codexImageLogger.warn({
      action: 'codex.reference.cleanup_failed',
      message: 'Codex reference image cleanup failed after local preparation error',
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
    })
  }
}

function readOptionString(options: AiProviderImageExecutionContext['options'], key: string): string | undefined {
  const value = options?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function buildCodexImagePrompt(input: AiProviderImageExecutionContext, imageModelId: string, referenceCount: number): string {
  const options = input.options
  const lines = [
    'Use the image_generation capability to create exactly one raster image.',
    `Target image model: ${imageModelId}`,
    referenceCount > 0 ? 'Use every attached reference image as visual context.' : 'Use the user prompt as the only visual input.',
    '',
    'User prompt:',
    input.prompt,
  ]

  const requested = [
    ['Size', readOptionString(options, 'size')],
    ['Aspect ratio', readOptionString(options, 'aspectRatio')],
    ['Resolution', readOptionString(options, 'resolution')],
    ['Output format', readOptionString(options, 'outputFormat')],
  ].filter((entry): entry is [string, string] => !!entry[1])
  if (requested.length > 0) {
    lines.push('', 'Requested output constraints:', ...requested.map(([label, value]) => `- ${label}: ${value}`))
  }

  lines.push(
    '',
    'Output contract:',
    '- Save exactly one final raster image in the current working directory.',
    '- Return only JSON: {"image_path":"<path>"}.',
  )
  return lines.join('\n')
}

async function normalizeCodexReferenceImage(
  input: string,
  userId: string,
): Promise<string> {
  try {
    return await resolveOwnedImageDataUrlForGeneration(input, userId)
  } catch (error) {
    if (
      error instanceof OutboundImageNormalizeError
      && error.code === 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT'
    ) {
      return await normalizeToBase64ForGeneration(input)
    }
    throw error
  }
}

export async function prepareCodexImageGeneration(
  input: AiProviderImageExecutionContext,
): Promise<AiProviderPreparedMediaExecution> {
  const references = (input.options?.referenceImages || [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
  const prepared = references.length > 0
    ? await prepareCodexImageInputs(
        references,
        async (reference) => await normalizeCodexReferenceImage(reference, input.userId),
      )
    : null
  if (references.length > 0 && prepared?.imagePaths.length === 0) {
    await cleanupReferencesAfterPreparationFailure(prepared.cleanup)
    throw new Error('CODEX_REFERENCE_IMAGE_INPUTS_EMPTY')
  }

  try {
    const imageModelId = input.selection.modelId || CODEX_DEFAULT_IMAGE_MODEL_ID
    const generation = await prepareCodexImageGenerationExecution({
      model: readOptionString(input.options, 'codexModelId') || CODEX_DEFAULT_MODEL_ID,
      prompt: buildCodexImagePrompt(input, imageModelId, prepared?.imagePaths.length || 0),
      imagePaths: prepared?.imagePaths || [],
    })
    return {
      cleanup: async () => {
        await Promise.all([
          generation.cleanup(),
          prepared?.cleanup() ?? Promise.resolve(),
        ])
      },
      execute: async () => {
        const result = await generation.execute()
        return {
          success: true,
          imageBase64: result.imageBase64,
          imageUrl: `data:${result.mimeType};base64,${result.imageBase64}`,
        }
      },
    }
  } catch (error) {
    await cleanupReferencesAfterPreparationFailure(prepared?.cleanup)
    throw error
  }
}
