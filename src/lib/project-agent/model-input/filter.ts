import type { AgentInputItem } from '@openai/agents'
import {
  estimateProjectAgentTextTokens,
  estimateProjectAgentUnknownTokens,
} from './estimate'
import {
  PROJECT_AGENT_RESERVED_OUTPUT_TOKENS,
  resolveProjectAgentModelInputBudget,
  type ProjectAgentModelInputBudget,
} from './budget'
import { shedProjectAgentToolResults } from './tool-result'
import type { ProjectAgentLocale } from '../locale'

/**
 * The single authority for what this agent's model sees on any given step.
 *
 * Three places used to answer that question without knowing about each other:
 * a message compressor that summarised chat text, an input converter that
 * silently dropped every role it did not recognise, and approval resume, which
 * restored a serialised run state and bypassed both. The compressor's summary
 * carried a role the converter dropped, so compression cost an LLM call and
 * delivered nothing; approval resume was governed by nothing at all.
 *
 * This filter runs before every model request, including the ones a restored
 * run state produces, so no execution path escapes it. It only rewrites the
 * payload being sent — the serialised state stays byte-identical, which the
 * approval contract requires.
 */
export type ProjectAgentModelInputDecision = {
  readonly input: AgentInputItem[]
  readonly instructions?: string
  readonly budget: ProjectAgentModelInputBudget | null
  readonly estimatedInputTokens: number
  readonly overBudget: boolean
  readonly clearedResultCount: number
  readonly freedTokens: number
}

export type ProjectAgentModelInputFilterInput = {
  readonly modelKey: string
  readonly toolSchemaTokens: number
  readonly locale: ProjectAgentLocale
  readonly irreplaceableToolNames: ReadonlySet<string>
}

/**
 * Results left verbatim regardless of pressure. The model is usually still
 * working with what it just fetched, so clearing the newest results would
 * force an immediate re-read and free nothing in practice.
 */
const KEEP_RECENT_TOOL_RESULTS = 5

/**
 * Clearing is aimed below the limit rather than at it. Stopping exactly at the
 * threshold would re-trigger on the next step and invalidate the prompt cache
 * again; overshooting once buys many steps of untouched prefix.
 */
const SHED_TARGET_RATIO = 0.7

export function decideProjectAgentModelInput(
  config: ProjectAgentModelInputFilterInput,
  modelData: { input: AgentInputItem[]; instructions?: string },
): ProjectAgentModelInputDecision {
  const instructionTokens = modelData.instructions
    ? estimateProjectAgentTextTokens(modelData.instructions)
    : 0
  const resolution = resolveProjectAgentModelInputBudget({
    modelKey: config.modelKey,
    instructionTokens,
    toolSchemaTokens: config.toolSchemaTokens,
    maxOutputTokens: PROJECT_AGENT_RESERVED_OUTPUT_TOKENS,
  })
  const budget = resolution.kind === 'resolved' ? resolution.budget : null
  const initialTokens = estimateProjectAgentUnknownTokens(modelData.input)

  // A null budget means the reservations already exhaust the window, which no
  // amount of shedding can fix; it is reported as over budget so the caller
  // surfaces it rather than proceeding as if the request were fine.
  if (budget === null) {
    return {
      input: modelData.input,
      ...(modelData.instructions === undefined ? {} : { instructions: modelData.instructions }),
      budget,
      estimatedInputTokens: initialTokens,
      overBudget: true,
      clearedResultCount: 0,
      freedTokens: 0,
    }
  }

  const shedding = initialTokens > budget.availableInputTokens
    ? shedProjectAgentToolResults({
      items: modelData.input,
      locale: config.locale,
      keepRecentResults: KEEP_RECENT_TOOL_RESULTS,
      targetFreedTokens: initialTokens - Math.floor(budget.availableInputTokens * SHED_TARGET_RATIO),
      irreplaceableToolNames: config.irreplaceableToolNames,
    })
    : null

  const input = shedding ? shedding.items : modelData.input
  const estimatedInputTokens = shedding ? initialTokens - shedding.freedTokens : initialTokens

  return {
    input,
    ...(modelData.instructions === undefined ? {} : { instructions: modelData.instructions }),
    budget,
    estimatedInputTokens,
    overBudget: estimatedInputTokens > budget.availableInputTokens,
    clearedResultCount: shedding?.clearedResultCount ?? 0,
    freedTokens: shedding?.freedTokens ?? 0,
  }
}
