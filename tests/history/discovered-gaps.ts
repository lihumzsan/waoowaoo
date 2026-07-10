export type DiscoveredTestGap = {
  readonly id: string
  readonly symptom: string
  readonly evidence: readonly string[]
  readonly owner: string
  readonly rationale: string
  readonly status: 'production-fix-required' | 'scenario-required'
}

export const DISCOVERED_TEST_GAPS: readonly DiscoveredTestGap[] = [
]
