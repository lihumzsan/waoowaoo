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
  | {
    readonly kind: 'window_too_small'
    readonly modelKey: string
    readonly contextWindow: number
    readonly requiredTokens: number
  }

/**
 * Platform ceiling on how large a model context may grow, independent of what
 * the model would technically accept.
 *
 * This is a quality decision before it is a cost one. Every model in the
 * catalogue advertises a window around a million tokens, but answer quality
 * degrades well before that: attention spreads thin and instructions in the
 * middle get dropped. Capping keeps the agent inside the range it actually
 * reasons well over, and shorter input is cheaper and faster as a side effect.
 *
 * A model that genuinely accepts less lowers this via its declared
 * `contextWindow` capability; the effective window is always the smaller of
 * the two, so a small-window model can never overflow because of this cap.
 */
export const DEFAULT_PROJECT_AGENT_CONTEXT_WINDOW_CAP = 256_000
export const PROJECT_AGENT_CONTEXT_WINDOW_CAP_ENV = 'PLATFORM_ASSISTANT_CONTEXT_WINDOW_CAP'

function readContextWindowCap(): number {
  const raw = process.env[PROJECT_AGENT_CONTEXT_WINDOW_CAP_ENV]?.trim()
  if (!raw) return DEFAULT_PROJECT_AGENT_CONTEXT_WINDOW_CAP
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`PROJECT_AGENT_CONTEXT_WINDOW_CAP_INVALID:${PROJECT_AGENT_CONTEXT_WINDOW_CAP_ENV}`)
  }
  return parsed
}

export function resolveProjectAgentEffectiveContextWindow(modelKey: string): number {
  const cap = readContextWindowCap()
  const declared = readModelContextWindow(modelKey)
  return declared === null ? cap : Math.min(cap, declared)
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
  const contextWindow = resolveProjectAgentEffectiveContextWindow(input.modelKey)
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
