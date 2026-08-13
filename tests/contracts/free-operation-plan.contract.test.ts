import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'

describe('free operation plan contract', () => {
  it('publishes media generation without billable confirmation or quote capability', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    for (const operationId of ['create_image', 'create_audio', 'create_video'] as const) {
      const operation = registry[operationId]
      if (!operation) throw new Error(`Required operation missing: ${operationId}`)
      expect(operation.confirmation, operationId).toMatchObject({ kind: 'none', required: false })
      expect(operation.resourceContract, operationId).not.toHaveProperty('alternativeGeneration')
      expect(JSON.stringify(operation)).not.toContain('billable')
      expect(JSON.stringify(operation)).not.toContain('quote')
      expect(JSON.stringify(operation)).not.toContain('credits')
    }
  })

  it('keeps destructive operations explicitly confirmable', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    const deleteResource = registry.delete_resource
    if (!deleteResource) throw new Error('delete_resource missing')
    expect(deleteResource.confirmation.required).toBe(true)
    expect(deleteResource.confirmation.kind).toBe('destructive')
  })
})
