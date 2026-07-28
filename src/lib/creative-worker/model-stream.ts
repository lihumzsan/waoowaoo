import type { RunStreamEvent } from '@openai/agents'

export function readCreativeWorkerOutputDelta(event: RunStreamEvent): string | null {
  if (
    event.type !== 'raw_model_stream_event'
    || event.data.type !== 'output_text_delta'
    || !event.data.delta
  ) return null
  return event.data.delta
}
