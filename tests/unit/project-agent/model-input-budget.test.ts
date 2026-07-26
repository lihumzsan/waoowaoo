import { describe, expect, it } from 'vitest'
import {
  PROJECT_AGENT_CONTEXT_WINDOW_CAP,
  resolveProjectAgentEffectiveContextWindow,
  resolveProjectAgentModelInputBudget,
} from '@/lib/project-agent/model-input/budget'
import {
  OPENROUTER_CLAUDE_SONNET_5_MODEL_ID,
  OPENROUTER_GPT_5_5_MODEL_ID,
  OPENROUTER_PROVIDER_TEST_LLM_MODEL_ID,
} from '@/lib/ai-providers/openrouter/models'

/**
 * Oracle: the effective window is the smaller of the platform cap and any
 * declared model window, and the input budget is that window minus every
 * measured reservation. Both are stated independently of the implementation.
 *
 * Rejects: taking the model's advertised window instead of the cap (a
 * million-token context the agent reasons poorly over), applying a ratio
 * instead of subtracting the measured terms, and returning a budget at all
 * when the reservations already exhaust the window.
 */
/** Declares a ~1M window, comfortably above the platform ceiling. */
const WIDE_MODEL_KEY = `openrouter::${OPENROUTER_CLAUDE_SONNET_5_MODEL_ID}`
/** Declares 128k, below the platform ceiling. */
const NARROW_MODEL_KEY = `openrouter::${OPENROUTER_PROVIDER_TEST_LLM_MODEL_ID}`
/** Declares no window at all. */
const UNDECLARED_MODEL_KEY = `openrouter::${OPENROUTER_GPT_5_5_MODEL_ID}`

describe('project agent model input budget', () => {
  it('caps a model that advertises far more than the platform allows', () => {
    expect(resolveProjectAgentEffectiveContextWindow(WIDE_MODEL_KEY))
      .toBe(PROJECT_AGENT_CONTEXT_WINDOW_CAP)
  })

  it('honours a declared window narrower than the cap', () => {
    // The cap must never raise a model above what it actually accepts;
    // that direction is a hard overflow rather than a quality trade-off.
    expect(resolveProjectAgentEffectiveContextWindow(NARROW_MODEL_KEY)).toBe(128_000)
  })

  it('falls back to the cap when the model declares no window', () => {
    expect(resolveProjectAgentEffectiveContextWindow(UNDECLARED_MODEL_KEY))
      .toBe(PROJECT_AGENT_CONTEXT_WINDOW_CAP)
  })

  it('subtracts every measured reservation from the effective window', () => {
    const resolution = resolveProjectAgentModelInputBudget({
      modelKey: WIDE_MODEL_KEY,
      instructionTokens: 6_000,
      toolSchemaTokens: 4_000,
      maxOutputTokens: 16_000,
    })
    expect(resolution.kind).toBe('resolved')
    if (resolution.kind !== 'resolved') return
    const { budget } = resolution
    expect(budget.contextWindow).toBe(PROJECT_AGENT_CONTEXT_WINDOW_CAP)
    expect(budget.availableInputTokens).toBe(
      PROJECT_AGENT_CONTEXT_WINDOW_CAP
      - 6_000
      - 4_000
      - 16_000
      - budget.reservedHeadroom,
    )
  })

  it('fails closed when the reservations already exhaust the window', () => {
    // The 128k provider-test model against reservations that exceed it.
    const resolution = resolveProjectAgentModelInputBudget({
      modelKey: NARROW_MODEL_KEY,
      instructionTokens: 60_000,
      toolSchemaTokens: 40_000,
      maxOutputTokens: 30_000,
    })
    // No budget is emitted here — a caller that received a zero or negative
    // allowance would silently send an over-long request instead of failing.
    expect(resolution.kind).toBe('window_too_small')
  })
})
