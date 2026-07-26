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
}

export type ProjectAgentModelInputFilterInput = {
  readonly modelKey: string
  readonly toolSchemaTokens: number
}

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
  const estimatedInputTokens = estimateProjectAgentUnknownTokens(modelData.input)
  const budget = resolution.kind === 'resolved' ? resolution.budget : null

  return {
    input: modelData.input,
    ...(modelData.instructions === undefined ? {} : { instructions: modelData.instructions }),
    budget,
    estimatedInputTokens,
    // A null budget means the reservations already exhaust the window, which no
    // amount of shedding can fix; it is reported as over budget so the caller
    // surfaces it rather than proceeding as if the request were fine.
    overBudget: budget === null || estimatedInputTokens > budget.availableInputTokens,
  }
}
