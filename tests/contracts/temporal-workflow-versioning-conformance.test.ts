import { VersioningBehavior } from '@temporalio/common'
import { describe, expect, it } from 'vitest'
import { TEMPORAL_WORKFLOW } from '@/lib/temporal/workflow-registry'
import * as workflowBundle from '@/lib/temporal/workflows'

function workflowVersioningBehavior(workflow: unknown): unknown {
  expect(typeof workflow).toBe('function')
  if (typeof workflow !== 'function') return undefined

  const options = Reflect.get(workflow, 'workflowDefinitionOptions')
  expect(options).toBeTypeOf('object')
  if (!options || typeof options !== 'object') return undefined

  return Reflect.get(options, 'versioningBehavior')
}

describe('Temporal Workflow versioning conformance', () => {
  it('registers every exported Workflow and applies its lifecycle-owned behavior', () => {
    const definitions = Object.values(TEMPORAL_WORKFLOW)
    const expectedTypes = definitions.map((definition) => definition.type).sort()

    expect(Object.keys(workflowBundle).sort()).toEqual(expectedTypes)

    for (const definition of definitions) {
      const expectedBehavior =
        definition.lifecycle === 'continuous'
          ? VersioningBehavior.AUTO_UPGRADE
          : VersioningBehavior.PINNED

      expect(definition.versioningBehavior).toBe(expectedBehavior)
      expect(
        workflowVersioningBehavior(Reflect.get(workflowBundle, definition.type)),
      ).toBe(expectedBehavior)
    }
  })
})
