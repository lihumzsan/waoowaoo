import { describe, expect, it } from 'vitest'
import { assertValidOperationPlanTaskEdges } from '@/lib/operations/task-edge-policy'

const tasks = [{ id: 'narration:1' }, { id: 'narration:2' }, { id: 'mix:1' }]

describe('OperationPlan internal Task edges', () => {
  it('accepts one acyclic required-success fan-in', () => {
    expect(() => assertValidOperationPlanTaskEdges(tasks, [
      { sourceTaskPlanId: 'narration:1', targetTaskPlanId: 'mix:1', requirement: 'required_success' },
      { sourceTaskPlanId: 'narration:2', targetTaskPlanId: 'mix:1', requirement: 'required_success' },
    ])).not.toThrow()
  })

  it.each([
    ['missing endpoint', [{ sourceTaskPlanId: 'missing', targetTaskPlanId: 'mix:1', requirement: 'required_success' }]],
    ['self edge', [{ sourceTaskPlanId: 'mix:1', targetTaskPlanId: 'mix:1', requirement: 'required_success' }]],
    ['duplicate edge', [
      { sourceTaskPlanId: 'narration:1', targetTaskPlanId: 'mix:1', requirement: 'required_success' },
      { sourceTaskPlanId: 'narration:1', targetTaskPlanId: 'mix:1', requirement: 'required_success' },
    ]],
    ['cycle', [
      { sourceTaskPlanId: 'narration:1', targetTaskPlanId: 'mix:1', requirement: 'required_success' },
      { sourceTaskPlanId: 'mix:1', targetTaskPlanId: 'narration:1', requirement: 'required_success' },
    ]],
  ] as const)('rejects %s', (_name, edges) => {
    expect(() => assertValidOperationPlanTaskEdges(tasks, edges)).toThrow()
  })
})
