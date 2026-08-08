import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import type { AiProviderImageExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { prepareCodexImageInputs, runCodexImageGeneration } from './client'
import { CODEX_DEFAULT_IMAGE_MODEL_ID, CODEX_DEFAULT_MODEL_ID } from './constants'

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

function formatCodexImageError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 1_000)
}

export async function executeCodexImageGeneration(
  input: AiProviderImageExecutionContext,
): Promise<GenerateResult> {
  const references = (input.options?.referenceImages || [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
  let prepared: Awaited<ReturnType<typeof prepareCodexImageInputs>> | null = null

  try {
    if (references.length > 0) {
      prepared = await prepareCodexImageInputs(references, normalizeToBase64ForGeneration)
      if (prepared.imagePaths.length === 0) {
        return { success: false, error: 'CODEX_REFERENCE_IMAGE_INPUTS_EMPTY' }
      }
    }

    const imageModelId = input.selection.modelId || CODEX_DEFAULT_IMAGE_MODEL_ID
    const result = await runCodexImageGeneration({
      model: readOptionString(input.options, 'codexModelId') || CODEX_DEFAULT_MODEL_ID,
      prompt: buildCodexImagePrompt(input, imageModelId, prepared?.imagePaths.length || 0),
      imagePaths: prepared?.imagePaths || [],
    })
    return {
      success: true,
      imageBase64: result.imageBase64,
      imageUrl: `data:${result.mimeType};base64,${result.imageBase64}`,
    }
  } catch (error) {
    return { success: false, error: formatCodexImageError(error) }
  } finally {
    await prepared?.cleanup().catch(() => undefined)
  }
}
