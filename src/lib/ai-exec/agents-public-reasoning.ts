import type { RunStreamEvent } from '@openai/agents'

export type AgentsPublicReasoningEvent =
  | { kind: 'start'; reasoningId: string }
  | { kind: 'delta'; reasoningId: string; delta: string }
  | { kind: 'end'; reasoningId: string; text: string }

type ReasoningBlock = {
  publicId: string
  text: string
  visible: boolean
  ended: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readRawModelPart(event: RunStreamEvent): Record<string, unknown> | null {
  if (event.type !== 'raw_model_stream_event' || event.data.type !== 'model') return null
  return isRecord(event.data.event) ? event.data.event : null
}

export type AgentsPublicReasoningNormalizer = {
  accept: (event: RunStreamEvent) => AgentsPublicReasoningEvent[]
  finish: () => AgentsPublicReasoningEvent[]
}

export function createAgentsPublicReasoningNormalizer(): AgentsPublicReasoningNormalizer {
  let responseOrdinal = 0
  let responseOpen = false
  const blocks = new Map<string, ReasoningBlock>()

  const finishOpenBlocks = (): AgentsPublicReasoningEvent[] => {
    const events: AgentsPublicReasoningEvent[] = []
    for (const block of blocks.values()) {
      if (block.ended) continue
      block.ended = true
      if (block.visible) {
        events.push({ kind: 'end', reasoningId: block.publicId, text: block.text })
      }
    }
    return events
  }

  const startResponse = (): AgentsPublicReasoningEvent[] => {
    const events = finishOpenBlocks()
    responseOrdinal += 1
    responseOpen = true
    blocks.clear()
    return events
  }

  const ensureResponse = (): AgentsPublicReasoningEvent[] => {
    return responseOpen ? [] : startResponse()
  }

  const getBlock = (providerId: string): ReasoningBlock => {
    const existing = blocks.get(providerId)
    if (existing) return existing
    const block: ReasoningBlock = {
      publicId: `reasoning:${responseOrdinal}:${providerId}`,
      text: '',
      visible: false,
      ended: false,
    }
    blocks.set(providerId, block)
    return block
  }

  return {
    accept(event) {
      if (event.type === 'raw_model_stream_event' && event.data.type === 'response_started') {
        return startResponse()
      }
      if (event.type === 'raw_model_stream_event' && event.data.type === 'response_done') {
        responseOpen = false
        return finishOpenBlocks()
      }

      const part = readRawModelPart(event)
      const partType = readString(part?.type)
      if (
        partType !== 'reasoning-start'
        && partType !== 'reasoning-delta'
        && partType !== 'reasoning-end'
      ) return []

      const events = ensureResponse()
      const providerId = readString(part?.id)?.trim() || 'default'
      const block = getBlock(providerId)

      if (partType === 'reasoning-start') {
        if (block.ended) {
          throw new Error(`AGENTS_PUBLIC_REASONING_REOPENED:${block.publicId}`)
        }
        return events
      }

      if (partType === 'reasoning-delta') {
        if (block.ended) {
          throw new Error(`AGENTS_PUBLIC_REASONING_DELTA_AFTER_END:${block.publicId}`)
        }
        const delta = readString(part?.delta) ?? ''
        if (!delta) return events
        if (!block.visible) {
          block.visible = true
          events.push({ kind: 'start', reasoningId: block.publicId })
        }
        block.text += delta
        events.push({ kind: 'delta', reasoningId: block.publicId, delta })
        return events
      }

      if (block.ended) return events
      block.ended = true
      if (block.visible) {
        events.push({ kind: 'end', reasoningId: block.publicId, text: block.text })
      }
      return events
    },
    finish() {
      responseOpen = false
      return finishOpenBlocks()
    },
  }
}
