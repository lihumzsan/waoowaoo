import type { AgentInputItem, Usage } from '@openai/agents'

/**
 * Observability for what the model actually receives.
 *
 * The runtime has five independent context sources and, before this module,
 * none of them was measured: budgets were decided from a hardcoded constant
 * that only counted chat text. Real `inputTokens` are the only authority for
 * how expensive a step was; the char measurements here exist solely to
 * calibrate an estimator against that authority. Nothing in this module
 * decides what the model sees.
 */
export const PROJECT_AGENT_CONTEXT_SOURCE_KINDS = [
  'instructions',
  'tool_schemas',
  'conversation',
  'project_state',
  'agent_plan',
] as const

export type ProjectAgentContextSourceKind = (typeof PROJECT_AGENT_CONTEXT_SOURCE_KINDS)[number]

export type ProjectAgentTextMeasurement = {
  readonly chars: number
  readonly cjkChars: number
}

export type ProjectAgentContextComposition = {
  readonly sources: Readonly<Record<ProjectAgentContextSourceKind, ProjectAgentTextMeasurement>>
  readonly total: ProjectAgentTextMeasurement
}

export type ProjectAgentUsageProjection = {
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  /**
   * Per-request input tokens in call order. This is what exposes in-run growth:
   * a flat series means the run stayed small, a rising series means tool
   * results accumulated. A single aggregate number cannot show either.
   */
  readonly inputTokensPerRequest: readonly number[]
  readonly maxInputTokens: number
  /**
   * Provider-reported input token breakdown per request, merged across
   * requests. Cache hit/write counters live here, and they are the only
   * authority for whether a caching decision (breakpoint placement, TTL
   * choice) actually paid off. Keys are passed through verbatim rather than
   * mapped to a fixed set, because each provider names them differently and
   * guessing would silently drop the ones we did not anticipate.
   */
  readonly inputTokenDetails: Readonly<Record<string, number>>
}

export type ProjectAgentContextTelemetry = {
  readonly composition: ProjectAgentContextComposition
  readonly usage: ProjectAgentUsageProjection
  /**
   * Measured chars per real input token on the first model request. The
   * legacy estimator assumed 4, which is an ASCII figure; Chinese-heavy
   * context lands far lower. Null when the first request reported no usage.
   */
  readonly charsPerInputToken: number | null
}

const CJK_CHAR_PATTERN = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u

const EMPTY_MEASUREMENT: ProjectAgentTextMeasurement = { chars: 0, cjkChars: 0 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function collectStrings(value: unknown, sink: string[]): void {
  if (typeof value === 'string') {
    sink.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, sink)
    return
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectStrings(item, sink)
  }
}

export function measureProjectAgentText(value: string): ProjectAgentTextMeasurement {
  let cjkChars = 0
  for (const char of value) {
    if (CJK_CHAR_PATTERN.test(char)) cjkChars += 1
  }
  return { chars: value.length, cjkChars }
}

function mergeMeasurements(
  measurements: readonly ProjectAgentTextMeasurement[],
): ProjectAgentTextMeasurement {
  return measurements.reduce<ProjectAgentTextMeasurement>((total, measurement) => ({
    chars: total.chars + measurement.chars,
    cjkChars: total.cjkChars + measurement.cjkChars,
  }), EMPTY_MEASUREMENT)
}

export function measureProjectAgentInputItems(
  items: readonly AgentInputItem[],
): ProjectAgentTextMeasurement {
  const strings: string[] = []
  collectStrings(items, strings)
  return mergeMeasurements(strings.map((value) => measureProjectAgentText(value)))
}

export function measureProjectAgentToolSchemas(
  tools: readonly unknown[],
): ProjectAgentTextMeasurement {
  const strings: string[] = []
  for (const tool of tools) {
    if (!isRecord(tool)) continue
    // The Tool union spans function/hosted/computer variants; only the schema
    // carrying fields matter here, so read them structurally rather than
    // narrowing to one variant.
    collectStrings(
      {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
      strings,
    )
  }
  return mergeMeasurements(strings.map((value) => measureProjectAgentText(value)))
}

export function buildProjectAgentContextComposition(input: {
  instructions: string
  toolSchemas: ProjectAgentTextMeasurement
  conversation: readonly AgentInputItem[]
  projectState: AgentInputItem
  agentPlan: AgentInputItem | null
}): ProjectAgentContextComposition {
  const sources: Record<ProjectAgentContextSourceKind, ProjectAgentTextMeasurement> = {
    instructions: measureProjectAgentText(input.instructions),
    tool_schemas: input.toolSchemas,
    conversation: measureProjectAgentInputItems(input.conversation),
    project_state: measureProjectAgentInputItems([input.projectState]),
    agent_plan: input.agentPlan ? measureProjectAgentInputItems([input.agentPlan]) : EMPTY_MEASUREMENT,
  }
  return {
    sources,
    total: mergeMeasurements(PROJECT_AGENT_CONTEXT_SOURCE_KINDS.map((kind) => sources[kind])),
  }
}

function readRequestInputTokens(usage: Usage): number[] {
  const entries = usage.requestUsageEntries
  if (!entries || entries.length === 0) return []
  return entries.map((entry) => entry.inputTokens)
}

function mergeInputTokenDetails(usage: Usage): Record<string, number> {
  const merged: Record<string, number> = {}
  const sources: Array<Record<string, number>> = usage.requestUsageEntries
    ? usage.requestUsageEntries.map((entry) => entry.inputTokensDetails)
    : usage.inputTokensDetails
  for (const source of sources) {
    if (!isRecord(source)) continue
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      merged[key] = (merged[key] ?? 0) + value
    }
  }
  return merged
}

export function projectProjectAgentUsage(usage: Usage): ProjectAgentUsageProjection {
  const inputTokensPerRequest = readRequestInputTokens(usage)
  return {
    inputTokenDetails: mergeInputTokenDetails(usage),
    requests: usage.requests,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    inputTokensPerRequest,
    maxInputTokens: inputTokensPerRequest.length > 0
      ? Math.max(...inputTokensPerRequest)
      : usage.inputTokens,
  }
}

export function buildProjectAgentContextTelemetry(input: {
  composition: ProjectAgentContextComposition
  usage: Usage
}): ProjectAgentContextTelemetry {
  const usage = projectProjectAgentUsage(input.usage)
  const firstRequestInputTokens = usage.inputTokensPerRequest[0] ?? null
  return {
    composition: input.composition,
    usage,
    charsPerInputToken: firstRequestInputTokens && firstRequestInputTokens > 0
      ? Number((input.composition.total.chars / firstRequestInputTokens).toFixed(3))
      : null,
  }
}
