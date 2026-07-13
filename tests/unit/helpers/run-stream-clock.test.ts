import { describe, expect, it } from 'vitest'
import { shouldTickRunStreamClock } from '@/lib/query/hooks/run-stream/run-stream-clock'

describe('shouldTickRunStreamClock', () => {
  it.each(['idle', 'completed', 'failed'] as const)('does not tick for %s streams', (status) => {
    expect(shouldTickRunStreamClock({
      isLiveRunning: false,
      isRecoveredRunning: false,
      status,
    })).toBe(false)
  })

  it('ticks for live, recovered, or running streams', () => {
    expect(shouldTickRunStreamClock({
      isLiveRunning: true,
      isRecoveredRunning: false,
      status: 'idle',
    })).toBe(true)
    expect(shouldTickRunStreamClock({
      isLiveRunning: false,
      isRecoveredRunning: true,
      status: 'idle',
    })).toBe(true)
    expect(shouldTickRunStreamClock({
      isLiveRunning: false,
      isRecoveredRunning: false,
      status: 'running',
    })).toBe(true)
  })
})
