import { getProviderConfig } from '@/lib/api-config'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import {
  prepareCodexImageInputs,
  runCodexImageGeneration,
} from '@/lib/providers/codex/client'
import {
  CODEX_DEFAULT_IMAGE_MODEL_ID,
  CODEX_DEFAULT_MODEL_ID,
  CODEX_PROVIDER_KEY,
} from '@/lib/providers/codex/constants'
import { BaseImageGenerator, type GenerateOptions, type GenerateResult, type ImageGenerateParams } from '../base'

function readOptionString(options: GenerateOptions, key: string): string | undefined {
  const value = options[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readErrorString(error: unknown, key: 'stdout' | 'stderr'): string {
  if (!error || typeof error !== 'object') return ''
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

function truncateDetail(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value
}

function formatCodexGenerationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const stdout = readErrorString(error, 'stdout')
  const stderr = readErrorString(error, 'stderr')
  const details = [message]
  if (stdout) details.push(`stdout: ${truncateDetail(stdout, 240)}`)
  if (stderr) details.push(`stderr: ${truncateDetail(stderr, 240)}`)
  return truncateDetail(details.join('\n'), 1000)
}

function buildCodexImagePrompt(params: {
  prompt: string
  imageModelId: string
  referenceCount: number
  options: GenerateOptions
}): string {
  const { prompt, imageModelId, referenceCount, options } = params
  const lines = [
    'You are generating an image through Codex with the image_generation feature enabled.',
    'Use the image_generation capability to create one raster image now. Do not answer with text only.',
    `Target image model: ${imageModelId}`,
    referenceCount > 0 ? 'Mode: multi-reference image fusion' : 'Mode: text-to-image',
    '',
    'User prompt:',
    prompt,
    '',
  ]

  const size = readOptionString(options, 'size')
  const aspectRatio = readOptionString(options, 'aspectRatio')
  const resolution = readOptionString(options, 'resolution')
  const outputFormat = readOptionString(options, 'outputFormat')
  if (size || aspectRatio || resolution || outputFormat) {
    lines.push('Requested output constraints:')
    if (size) lines.push(`- Size: ${size}`)
    if (aspectRatio) lines.push(`- Aspect ratio: ${aspectRatio}`)
    if (resolution) lines.push(`- Resolution: ${resolution}`)
    if (outputFormat) lines.push(`- Output format: ${outputFormat}`)
    lines.push('')
  }

  if (referenceCount > 0) {
    lines.push('Reference images:')
    for (let index = 0; index < referenceCount; index += 1) {
      lines.push(`- Reference Image ${index + 1}: attached with the same index in the Codex image inputs.`)
    }
    lines.push(
      '',
      'Use every reference image as visual context. Preserve the important identity, product, character, style, composition, and scene cues requested by the user.',
      'fuse all references into one coherent new image according to the user prompt.',
      'Do not make a collage, contact sheet, side-by-side layout, or first-image-only edit.',
      '',
    )
  }

  lines.push(
    'Output contract:',
    '- Create exactly one final raster image file in the current working directory.',
    '- If the image_generation result is stored elsewhere, copy or save that final image into the current working directory before answering.',
    '- Return only JSON in the final message, with this shape: {"image_path":"<relative-or-absolute-path-to-the-generated-image>"}',
  )

  return lines.join('\n')
}

export class CodexImageGenerator extends BaseImageGenerator {
  private readonly imageModelId?: string
  private readonly providerId?: string

  constructor(imageModelId?: string, providerId?: string) {
    super()
    this.imageModelId = imageModelId
    this.providerId = providerId
  }

  protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
    const { userId, prompt, referenceImages = [], options = {} } = params
    const providerId = typeof options.provider === 'string' && options.provider.trim()
      ? options.provider.trim()
      : (this.providerId || CODEX_PROVIDER_KEY)
    const providerConfig = await getProviderConfig(userId, providerId)
    const imageModelId = typeof options.modelId === 'string' && options.modelId.trim()
      ? options.modelId.trim()
      : (this.imageModelId || CODEX_DEFAULT_IMAGE_MODEL_ID)
    const codexModelId = readOptionString(options, 'codexModelId') || CODEX_DEFAULT_MODEL_ID

    let preparedImages: Awaited<ReturnType<typeof prepareCodexImageInputs>> | null = null

    try {
      const references = referenceImages.map((image) => image.trim()).filter(Boolean)
      if (references.length > 0) {
        preparedImages = await prepareCodexImageInputs(references, normalizeToBase64ForGeneration)
        if (preparedImages.imagePaths.length === 0) {
          return {
            success: false,
            error: 'CODEX_REFERENCE_IMAGE_INPUTS_EMPTY: no readable reference images were prepared',
          }
        }
      }

      const result = await runCodexImageGeneration({
        codexPath: providerConfig.baseUrl,
        model: codexModelId,
        prompt: buildCodexImagePrompt({
          prompt,
          imageModelId,
          referenceCount: preparedImages?.imagePaths.length ?? 0,
          options,
        }),
        imagePaths: preparedImages?.imagePaths ?? [],
      })

      return {
        success: true,
        imageBase64: result.imageBase64,
        imageUrl: `data:${result.mimeType};base64,${result.imageBase64}`,
      }
    } catch (error) {
      return {
        success: false,
        error: formatCodexGenerationError(error),
      }
    } finally {
      await preparedImages?.cleanup().catch(() => undefined)
    }
  }
}
