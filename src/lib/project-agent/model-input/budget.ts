import { readModelContextWindow } from '@/lib/ai-exec/model-context-window'

/**
 * How much of a model's window this run may spend on input.
 *
 * The previous implementation compared chat text against a hardcoded 12000,
 * a figure tied to no model and counting none of the instructions, tool
 * schemas, project state or tool results that actually fill the window. The
 * budget here is subtraction from a declared window, not a ratio: every term
 * below is measurable at the call site, and a ratio is what you reach for when
 * they are not.
 */
export type ProjectAgentModelInputBudget = {
  readonly contextWindow: number
  readonly reservedForInstructions: number
  readonly reservedForToolSchemas: number
  readonly reservedForOutput: number
  readonly reservedHeadroom: number
  /** Tokens the conversation, project state and tool results may occupy. */
  readonly availableInputTokens: number
}

export type ProjectAgentModelInputBudgetResolution =
  | { readonly kind: 'resolved'; readonly budget: ProjectAgentModelInputBudget }
  | { readonly kind: 'context_window_undeclared'; readonly modelKey: string }
  | {
    readonly kind: 'window_too_small'
    readonly modelKey: string
    readonly contextWindow: number
    readonly requiredTokens: number
  }

/**
 * Headroom absorbs the gap between our token estimate and the provider's real
 * count. It is not a safety ratio standing in for a missing measurement; the
 * measured terms are subtracted exactly and only this residual is a margin.
 */
const RESERVED_HEADROOM_TOKENS = 2_000

export function resolveProjectAgentModelInputBudget(input: {
  modelKey: string
  instructionTokens: number
  toolSchemaTokens: number
  maxOutputTokens: number
}): ProjectAgentModelInputBudgetResolution {
  const contextWindow = readModelContextWindow(input.modelKey)
  if (contextWindow === null) {
    return { kind: 'context_window_undeclared', modelKey: input.modelKey }
  }

  const requiredTokens = input.instructionTokens
    + input.toolSchemaTokens
    + input.maxOutputTokens
    + RESERVED_HEADROOM_TOKENS
  if (requiredTokens >= contextWindow) {
    return {
      kind: 'window_too_small',
      modelKey: input.modelKey,
      contextWindow,
      requiredTokens,
    }
  }

  return {
    kind: 'resolved',
    budget: {
      contextWindow,
      reservedForInstructions: input.instructionTokens,
      reservedForToolSchemas: input.toolSchemaTokens,
      reservedForOutput: input.maxOutputTokens,
      reservedHeadroom: RESERVED_HEADROOM_TOKENS,
      availableInputTokens: contextWindow - requiredTokens,
    },
  }
}
