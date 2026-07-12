import type { ProjectAgentRunStatus } from './runs'

export const PROJECT_AGENT_RUN_NON_TERMINAL_STATUSES = [
  'running',
  'awaiting_approval',
  'awaiting_choice',
  'awaiting_task',
] as const satisfies readonly ProjectAgentRunStatus[]

const RUN_TRANSITIONS = {
  running: [
    'running',
    'awaiting_approval',
    'awaiting_choice',
    'awaiting_task',
    'completed',
    'failed',
    'cancelled',
  ],
  awaiting_approval: ['awaiting_approval', 'running', 'cancelled'],
  awaiting_choice: ['awaiting_choice', 'running', 'cancelled'],
  awaiting_task: [
    'awaiting_task',
    'running',
    'awaiting_choice',
    'completed',
    'failed',
    'cancelled',
  ],
  completed: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<ProjectAgentRunStatus, readonly ProjectAgentRunStatus[]>

export function normalizeProjectAgentRunStatus(value: string): ProjectAgentRunStatus {
  if (
    value === 'running'
    || value === 'awaiting_approval'
    || value === 'awaiting_choice'
    || value === 'awaiting_task'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
  ) return value
  throw new Error(`PROJECT_AGENT_RUN_STATUS_INVALID:${value}`)
}

export function isProjectAgentRunTerminalStatus(status: ProjectAgentRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function canTransitionProjectAgentRun(params: {
  from: ProjectAgentRunStatus
  to: ProjectAgentRunStatus
  expectedStatuses?: readonly ProjectAgentRunStatus[]
}): boolean {
  if (params.expectedStatuses && !params.expectedStatuses.includes(params.from)) return false
  return (RUN_TRANSITIONS[params.from] as readonly ProjectAgentRunStatus[]).includes(params.to)
}

export function assertProjectAgentRunTransition(params: {
  runId: string
  from: ProjectAgentRunStatus
  to: ProjectAgentRunStatus
  expectedStatuses?: readonly ProjectAgentRunStatus[]
}): void {
  if (canTransitionProjectAgentRun(params)) return
  throw new Error(
    `PROJECT_AGENT_RUN_TRANSITION_INVALID runId=${params.runId} from=${params.from} to=${params.to}`,
  )
}
