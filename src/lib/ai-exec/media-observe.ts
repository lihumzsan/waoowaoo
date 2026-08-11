import { createScopedLogger } from '@/lib/logging/core'
import { normalizeAnyError } from '@/lib/errors/normalize'
import type { ErrorFields } from '@/lib/logging/types'
import type { GenerateResult } from '@/lib/ai-providers/runtime-types'
import type { AiMediaExecutionInput, AiMediaExecutionModality } from '@/lib/ai-exec/engine'
import { musicCompositionPlanDurationMs } from '@/lib/music/composition-plan'

/**
 * Media provider execution observability (logging only).
 *
 * Contract (logging-observability LG-03): events carry IDs, size summaries and
 * durations only — never prompt text, media URLs, base64 payloads or any other
 * business content. Observation failures are swallowed so instrumentation can
 * never affect generation behaviour.
 */

const mediaLogger = createScopedLogger({ module: 'ai-exec.media' })

function safeObserve(emit: () => void): void {
  try {
    emit()
  } catch {
    // Observability must never affect generation.
  }
}

function safeSummary(summarize: () => Record<string, unknown>): Record<string, unknown> | null {
  try {
    return summarize()
  } catch {
    return null
  }
}

function serializeObservedError(error: unknown, fallbackMessage: string): ErrorFields {
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }
  return { message: fallbackMessage }
}

/** Size/count-only projection of a media request; no prompt text and no URLs. */
export function summarizeMediaRequestInput(input: AiMediaExecutionInput): Record<string, unknown> {
  switch (input.modality) {
  case 'image':
    return {
      promptChars: input.prompt.length,
      referenceImageCount: input.options?.referenceImages?.length ?? 0,
      aspectRatio: input.options?.aspectRatio ?? null,
      resolution: input.options?.resolution ?? null,
    }
  case 'video':
    return {
      hasSourceImage: Boolean(input.imageUrl),
      promptChars: input.options?.prompt?.length ?? 0,
      referenceImageCount: input.options?.referenceImages?.length ?? 0,
      referenceAudioCount: input.options?.referenceAudios?.length ?? 0,
      referenceVideoCount: input.options?.referenceVideos?.length ?? 0,
      durationSeconds: typeof input.options?.duration === 'number' ? input.options.duration : null,
      resolution: input.options?.resolution ?? null,
    }
  case 'music':
    if (input.generation.kind === 'prompt') {
      return {
        generationMode: 'prompt',
        promptChars: input.generation.prompt.length,
        negativePromptChars: input.options?.negativePrompt?.length ?? 0,
        durationSeconds: input.options?.durationSeconds ?? null,
      }
    }
    return {
      generationMode: 'composition_plan',
      chunkCount: input.generation.compositionPlan.chunks.length,
      durationMs: musicCompositionPlanDurationMs(input.generation.compositionPlan),
      positiveStyleCount: input.generation.compositionPlan.chunks.reduce(
        (total, chunk) => total + chunk.positiveStyles.length,
        0,
      ),
      negativeStyleCount: input.generation.compositionPlan.chunks.reduce(
        (total, chunk) => total + chunk.negativeStyles.length,
        0,
      ),
    }
  case 'voice':
    return {
      descriptionChars: input.description.length,
      textChars: input.text.length,
      language: input.options?.language ?? null,
    }
  }
}

/** Count/flag-only projection of a provider result; URLs and base64 stay out. */
export function summarizeGenerateResult(result: GenerateResult): Record<string, unknown> {
  return {
    success: result.success,
    async: result.async ?? false,
    imageCount: result.imageUrls?.length ?? (result.imageUrl ? 1 : 0),
    hasVideo: Boolean(result.videoUrl),
    hasAudio: Boolean(result.audioUrl || result.audioBase64),
    base64Chars: (result.imageBase64?.length ?? 0) + (result.audioBase64?.length ?? 0),
    externalId: result.externalId ?? null,
    requestId: result.requestId ?? null,
  }
}

export type MediaProviderObserveContext = {
  /** Real provider key from the resolved selection/route; null only when genuinely unknown. */
  provider: string | null
  modelKey: string
  modality: AiMediaExecutionModality
  /** `execute` = provider submission/sync call; `async_wait` = shared poll wait inside the engine. */
  phase: 'execute' | 'async_wait'
  requestSummary: () => Record<string, unknown>
}

export function logMediaModelSelectionResolved(input: {
  modality: AiMediaExecutionModality
  provider: string
  modelKey: string
}): void {
  safeObserve(() => mediaLogger.info({
    action: 'media.provider.selection',
    message: 'media model selection resolved',
    provider: input.provider,
    details: { modality: input.modality, modelKey: input.modelKey },
  }))
}

/**
 * Wraps one media provider execution attempt with request/response/failure
 * events. Rethrows the original error unchanged; never alters control flow.
 */
export async function wrapMediaProviderExecution<T>(
  context: MediaProviderObserveContext,
  execute: () => Promise<T>,
  summarizeResult: (result: T) => Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now()
  safeObserve(() => mediaLogger.info({
    action: 'media.provider.request',
    message: `media provider request (${context.modality}:${context.phase})`,
    provider: context.provider ?? undefined,
    details: {
      modality: context.modality,
      modelKey: context.modelKey,
      phase: context.phase,
      provider: context.provider,
      request: safeSummary(context.requestSummary),
    },
  }))
  try {
    const result = await execute()
    safeObserve(() => mediaLogger.info({
      action: 'media.provider.response',
      message: `media provider response (${context.modality}:${context.phase})`,
      provider: context.provider ?? undefined,
      durationMs: Date.now() - startedAt,
      details: {
        modality: context.modality,
        modelKey: context.modelKey,
        phase: context.phase,
        provider: context.provider,
        result: safeSummary(() => summarizeResult(result)),
      },
    }))
    return result
  } catch (error) {
    safeObserve(() => {
      const normalized = normalizeAnyError(error)
      mediaLogger.error({
        action: 'media.provider.failed',
        message: `media provider failed (${context.modality}:${context.phase})`,
        provider: context.provider ?? normalized.context.provider,
        errorCode: normalized.interpretation.code,
        retryable: normalized.recovery.taskReplay === 'safe',
        durationMs: Date.now() - startedAt,
        details: {
          modality: context.modality,
          modelKey: context.modelKey,
          phase: context.phase,
          provider: context.provider,
        },
        error: serializeObservedError(error, normalized.native.message),
      })
    })
    throw error
  }
}
