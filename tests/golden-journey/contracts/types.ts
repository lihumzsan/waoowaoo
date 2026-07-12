import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'

export interface GoldenScenarioContract {
  readonly id: string
  readonly kind: 'mainline' | 'security'
  readonly title: string
  readonly startStage: EditFirstWorkflowStage | 'outside_workflow'
  readonly expectedTerminal: EditFirstWorkflowStage | string
  readonly requiresWorkers: boolean
  readonly zeroPaidProviderCalls: true
}
