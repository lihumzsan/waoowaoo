export function parseProjectAgentSessionEventWatermark(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error('PROJECT_AGENT_SESSION_EVENT_WATERMARK_INVALID')
  }
  return value
}

export function isProjectAgentSessionEventWatermarkAtLeast(params: {
  candidate: string
  required: string
}): boolean {
  return BigInt(parseProjectAgentSessionEventWatermark(params.candidate))
    >= BigInt(parseProjectAgentSessionEventWatermark(params.required))
}

export function maxProjectAgentSessionEventWatermark(left: string, right: string): string {
  return BigInt(parseProjectAgentSessionEventWatermark(left))
    >= BigInt(parseProjectAgentSessionEventWatermark(right))
    ? left
    : right
}
