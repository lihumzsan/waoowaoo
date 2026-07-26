import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { OPERATION_MODEL_RESULT_RETENTIONS } from '@/lib/operations/types'

/**
 * Oracle: an Operation that suspends for a user answer receives that answer as
 * a synthetic tool result which exists nowhere else. Shedding it under context
 * pressure would silently discard a decision the user already made, and
 * re-issuing the call would ask them the same question again — so every
 * suspending Operation must be declared irreplaceable.
 *
 * Enumerated from the production registry rather than a maintained list, so a
 * new suspending Operation fails here until it declares its retention.
 */
describe('project agent model result retention conformance', () => {
  const registry = createProjectAgentOperationRegistry()
  const operations = Object.values(registry)

  it('classifies every production Operation', () => {
    expect(operations.length).toBeGreaterThan(0)
    for (const operation of operations) {
      expect(OPERATION_MODEL_RESULT_RETENTIONS).toContain(operation.modelResultRetention)
    }
  })

  it('marks every suspending Operation irreplaceable', () => {
    const suspending = operations.filter((operation) => operation.agentFlow?.suspendsFor)
    expect(suspending.length).toBeGreaterThan(0)
    expect(
      suspending
        .filter((operation) => operation.modelResultRetention !== 'irreplaceable')
        .map((operation) => operation.id),
    ).toEqual([])
  })
})
