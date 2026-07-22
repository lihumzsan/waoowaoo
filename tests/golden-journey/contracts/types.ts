export interface GoldenScenarioContract {
  readonly id: string
  readonly kind: 'freeform' | 'security'
  readonly title: string
  readonly startState: 'empty_project' | 'outside_workspace'
  readonly expectedTerminal: string
  readonly requiresWorkers: boolean
  readonly zeroPaidProviderCalls: true
}
