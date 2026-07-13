import type { RunState } from './types'

interface RunStreamClockState {
  isLiveRunning: boolean
  isRecoveredRunning: boolean
  status: RunState['status'] | 'idle'
}

export function shouldTickRunStreamClock(state: RunStreamClockState): boolean {
  return state.isLiveRunning || state.isRecoveredRunning || state.status === 'running'
}
