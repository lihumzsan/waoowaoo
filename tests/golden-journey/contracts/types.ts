import type {
  EditFirstWorkflowStatusKind,
  EditFirstWorkflowStep,
} from '@/lib/project-workflow/edit-first-view'

export interface GoldenScenarioContract {
  readonly id: string
  readonly kind: 'mainline' | 'freeform' | 'security'
  readonly title: string
  readonly startStep: EditFirstWorkflowStep | 'outside_workflow'
  readonly expectedTerminal: Readonly<{
    step: EditFirstWorkflowStep
    status: EditFirstWorkflowStatusKind
  }> | string
  readonly requiresWorkers: boolean
  readonly zeroPaidProviderCalls: true
}
