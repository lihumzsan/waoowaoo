import type { RunStreamEvent } from '@openai/agents'

export type CreativeWorkerGenerationBoundary = 'started' | 'completed'

export function readCreativeWorkerGenerationBoundary(
  event: RunStreamEvent,
): CreativeWorkerGenerationBoundary | null {
  if (event.type !== 'raw_model_stream_event') return null
  if (event.data.type === 'response_started') return 'started'
  if (event.data.type === 'response_done') return 'completed'
  return null
}

export function readCreativeWorkerOutputDelta(event: RunStreamEvent): string | null {
  if (
    event.type !== 'raw_model_stream_event'
    || event.data.type !== 'output_text_delta'
    || !event.data.delta
  ) return null
  return event.data.delta
}
