import { ApiError } from '@/lib/api-errors'
import { augmentFailureRecord } from '@/lib/errors/failure'
import type { ProjectAgentToolInputCorrection } from '@/lib/operations/tool-input-schema'
import { H3PromptValidationError } from '@/lib/video-generation/h3-prompt-error'

export type GenerationPlanInput = {
  readonly inputIndex: number
} & (
  | { readonly itemId: string; readonly resourceId?: never }
  | { readonly resourceId: string; readonly itemId?: never }
)

/** Only read-only planning belongs here. Commit/submission must follow success. */
export async function collectGenerationPlans<T>(entries: readonly {
  readonly input: GenerationPlanInput
  readonly plan: () => Promise<T>
}[]): Promise<T[]> {
  const results = await Promise.allSettled(entries.map(async (entry) => await entry.plan()))
  const plans: T[] = []
  const corrections: ProjectAgentToolInputCorrection[] = []
  const reported = new Set<string>()
  let firstValidationError: H3PromptValidationError | undefined

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      plans.push(result.value)
      continue
    }
    const error: unknown = result.reason
    // Cancellation, system errors, configuration errors and other domain
    // failures retain their identity, even alongside correctable H3 errors.
    if (!(error instanceof H3PromptValidationError) || error.correction === null) throw error
    firstValidationError ??= error
    const input = entries[index]!.input
    const key = JSON.stringify([input.inputIndex, error.issueCode, error.section, error.detail])
    if (reported.has(key)) continue
    reported.add(key)
    corrections.push({
      action: 'fix_invalid_value',
      fieldPath: `$input.request.items[${String(input.inputIndex)}].prompt`,
      ...(input.itemId !== undefined ? { itemId: input.itemId } : { resourceId: input.resourceId }),
      ...(error.section ? { section: error.section } : {}),
      issueCode: error.issueCode,
      reason: error.message,
      message: error.correction,
    })
  }

  if (firstValidationError) {
    // FailureRecord and the model projector bound correction arrays to 20.
    // Stay below FailureRecord's whole-details budget as well. Declare the
    // full count so truncation never implies the remaining inputs are valid.
    const boundedCorrections: ProjectAgentToolInputCorrection[] = []
    let characters = 0
    for (const correction of corrections.slice(0, 20)) {
      const size = JSON.stringify(correction).length
      if (characters + size > 12_000) break
      boundedCorrections.push(correction)
      characters += size
    }
    throw ApiError.fromFailure(augmentFailureRecord(firstValidationError.failure, {
      context: { system: 'application', phase: 'generation_plan_validation' },
      details: {
        code: 'VIDEO_PROMPT_PROFILE_INVALID',
        field: 'items.prompt',
        corrections: boundedCorrections,
        correctionCount: corrections.length,
      },
    }), firstValidationError)
  }
  return plans
}
