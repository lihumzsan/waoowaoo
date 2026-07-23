import type { CreativeSkillId } from '@/lib/creative-skills'
import { CreativeWorkerError } from './errors'
import type { CreativeSkillReadTraceEntry } from './types'

export interface CreativeWorkerReadSkillToolCall {
  readonly toolCallId: string
  readonly toolName: 'read_skill'
  readonly skillId: CreativeSkillId
}

export interface CompletedCreativeWorkerReadSkillToolCall {
  readonly toolCall: CreativeWorkerReadSkillToolCall
  readonly trace: CreativeSkillReadTraceEntry
}

export class CreativeWorkerToolLifecycle {
  private readonly activeCalls = new Map<string, CreativeWorkerReadSkillToolCall>()
  private readonly claimedTraceOrdinals = new Set<number>()

  begin(toolCall: CreativeWorkerReadSkillToolCall): void {
    if (this.activeCalls.has(toolCall.toolCallId)) {
      throw new CreativeWorkerError('CREATIVE_WORK_RUN_FAILED', {
        reason: 'creative worker tool call identity is duplicated',
      })
    }
    this.activeCalls.set(toolCall.toolCallId, toolCall)
  }

  complete(
    toolCallId: string,
    skillTrace: readonly CreativeSkillReadTraceEntry[],
  ): CompletedCreativeWorkerReadSkillToolCall {
    const toolCall = this.activeCalls.get(toolCallId)
    if (!toolCall) {
      throw new CreativeWorkerError('CREATIVE_WORK_RUN_FAILED', {
        reason: 'creative worker tool output has no matching active tool call',
      })
    }
    const trace = skillTrace.find((entry) => (
      entry.source === 'tool'
      && entry.skillId === toolCall.skillId
      && !this.claimedTraceOrdinals.has(entry.ordinal)
    ))
    if (!trace) {
      throw new CreativeWorkerError('CREATIVE_WORK_RUN_FAILED', {
        reason: 'read_skill completed without an unclaimed trace entry',
      })
    }
    this.claimedTraceOrdinals.add(trace.ordinal)
    this.activeCalls.delete(toolCallId)
    return { toolCall, trace }
  }

  drainActive(): readonly CreativeWorkerReadSkillToolCall[] {
    const activeCalls = [...this.activeCalls.values()]
    this.activeCalls.clear()
    return activeCalls
  }

  assertSettled(): void {
    if (this.activeCalls.size > 0) {
      throw new CreativeWorkerError('CREATIVE_WORK_RUN_FAILED', {
        reason: 'creative worker run ended with unsettled tool calls',
      })
    }
  }
}
