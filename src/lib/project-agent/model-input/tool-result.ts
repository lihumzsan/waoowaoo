import type { AgentInputItem } from '@openai/agents'
import type { ProjectAgentLocale } from '../locale'
import { estimateProjectAgentUnknownTokens } from './estimate'

/**
 * Shedding tool result bodies under context pressure.
 *
 * A tool result is the one part of an agent's context that is usually
 * recoverable: the agent already knows how to fetch it, because it just did.
 * The system already loads capability on demand — what it never did was
 * unload, so a screenplay read at step two stayed verbatim in context through
 * step twelve. This completes that half.
 *
 * The call record is always preserved. The model keeps knowing that it made
 * the call, with what arguments, and how it ended; only the body is replaced,
 * with a note naming the tool so the model can re-issue it if it needs the
 * content again. Dropping the call itself would make the model believe the
 * work never happened and redo it.
 */
export type ProjectAgentToolResultShedding = {
  readonly items: AgentInputItem[]
  readonly clearedResultCount: number
  readonly freedTokens: number
}

export type ProjectAgentToolResultShedInput = {
  readonly items: readonly AgentInputItem[]
  readonly locale: ProjectAgentLocale
  /** Most recent results left untouched; the model is usually still using them. */
  readonly keepRecentResults: number
  /** Stop clearing once this many tokens have been freed. */
  readonly targetFreedTokens: number
  /** Operation ids whose results carry facts that exist nowhere else. */
  readonly irreplaceableToolNames: ReadonlySet<string>
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFunctionCallResult(item: AgentInputItem): boolean {
  return isRecord(item) && item.type === 'function_call_result'
}

function readToolName(item: AgentInputItem): string {
  const record = item as UnknownRecord
  return typeof record.name === 'string' ? record.name : 'unknown'
}

function isAlreadyCleared(item: AgentInputItem): boolean {
  const output = (item as UnknownRecord).output
  return isRecord(output) && output.clearedByContextBudget === true
}

export function buildProjectAgentClearedResultText(
  locale: ProjectAgentLocale,
  toolName: string,
): string {
  return locale === 'en'
    ? `[result cleared to free context. The call above already ran; re-issue ${toolName} only if you need its content again.]`
    : `[结果已清理以释放上下文。上面这次调用已经执行过；确实还需要其内容时再重新调用 ${toolName}。]`
}

function clearResultItem(item: AgentInputItem, locale: ProjectAgentLocale): AgentInputItem {
  const record = item as UnknownRecord
  return {
    ...record,
    output: {
      type: 'text',
      text: buildProjectAgentClearedResultText(locale, readToolName(item)),
      clearedByContextBudget: true,
    },
  } as unknown as AgentInputItem
}

/**
 * Clears oldest-first and stops as soon as the target is met.
 *
 * Clearing invalidates the provider prompt cache from the first edited item
 * onward, so a pass that trims a little every turn would pay that cost every
 * turn and save nothing. One pass frees the whole target, then leaves the
 * prefix alone until the next threshold is crossed.
 */
export function shedProjectAgentToolResults(
  input: ProjectAgentToolResultShedInput,
): ProjectAgentToolResultShedding {
  const resultPositions: number[] = []
  input.items.forEach((item, index) => {
    if (isFunctionCallResult(item)) resultPositions.push(index)
  })

  const clearablePositions = resultPositions
    .slice(0, Math.max(0, resultPositions.length - input.keepRecentResults))
    .filter((index) => {
      const item = input.items[index]
      if (!item || isAlreadyCleared(item)) return false
      return !input.irreplaceableToolNames.has(readToolName(item))
    })

  const toClear = new Set<number>()
  let freedTokens = 0
  for (const index of clearablePositions) {
    if (freedTokens >= input.targetFreedTokens) break
    const item = input.items[index]
    if (!item) continue
    const before = estimateProjectAgentUnknownTokens(item)
    const after = estimateProjectAgentUnknownTokens(clearResultItem(item, input.locale))
    if (after >= before) continue
    toClear.add(index)
    freedTokens += before - after
  }

  if (toClear.size === 0) {
    return { items: [...input.items], clearedResultCount: 0, freedTokens: 0 }
  }

  return {
    items: input.items.map((item, index) => (
      toClear.has(index) ? clearResultItem(item, input.locale) : item
    )),
    clearedResultCount: toClear.size,
    freedTokens,
  }
}
