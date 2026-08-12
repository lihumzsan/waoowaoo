import type { ProjectAgentPlanSnapshot } from '@/lib/project-agent/plan'

export const ASSISTANT_UI_LAB_STAGE_KEYS = [
  'user',
  'reasoning',
  'plan',
  'search',
  'command',
  'fileChange',
  'runtime',
  'approval',
  'failure',
  'final',
] as const

export type AssistantUiLabStageKey = (typeof ASSISTANT_UI_LAB_STAGE_KEYS)[number]

export interface AssistantUiLabToolDefinition {
  readonly id: 'search' | 'command' | 'fileChange' | 'failedCommand' | 'retryCommand'
  readonly stage: number
  readonly icon: 'read' | 'run' | 'write'
  readonly toolName: 'web_search' | 'shell' | 'file_change'
}

export const ASSISTANT_UI_LAB_TOOLS: readonly AssistantUiLabToolDefinition[] = [
  { id: 'search', stage: 3, icon: 'read', toolName: 'web_search' },
  { id: 'command', stage: 4, icon: 'run', toolName: 'shell' },
  { id: 'fileChange', stage: 5, icon: 'write', toolName: 'file_change' },
  { id: 'failedCommand', stage: 8, icon: 'run', toolName: 'shell' },
  { id: 'retryCommand', stage: 8, icon: 'run', toolName: 'shell' },
] as const

export function buildAssistantUiLabPlan(copy: {
  readonly step1: string
  readonly step2: string
  readonly step3: string
}, stage: number): ProjectAgentPlanSnapshot {
  const currentIndex = stage < 4 ? 0 : stage < 7 ? 1 : 2
  return {
    explanation: null,
    plan: [copy.step1, copy.step2, copy.step3].map((step, index) => ({
      step,
      status: index < currentIndex
        ? 'completed'
        : index === currentIndex
          ? 'in_progress'
          : 'pending',
    })),
  }
}
