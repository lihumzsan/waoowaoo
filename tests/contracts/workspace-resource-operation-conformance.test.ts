import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { OPERATION_EXECUTION_MAX_TASKS } from '@/lib/temporal/operation-execution/contracts'
import { requireWorkspaceResourceSchema } from '@/lib/workspace-resource/schema-registry'

describe('WorkspaceResource Operation registry conformance', () => {
  it('aligns every declared producer with the canonical Resource schema registry', () => {
    const registry = createProjectAgentOperationRegistryForApi()

    for (const [operationId, operation] of Object.entries(registry)) {
      if (operation.confirmation.kind === 'billable_media') {
        expect(operation.plan, operationId).toBeTypeOf('function')
        expect(operation.commit, operationId).toBeTypeOf('function')
      }
      if (operation.resourceContract.kind !== 'resource') continue

      expect(operation.resourceContract.placement, operationId).toBe('required')
      for (const schemaId of operation.resourceContract.outputSchemaIds) {
        const schema = requireWorkspaceResourceSchema(schemaId)
        expect(operation.resourceContract.outputResourceKinds, operationId)
          .toContain(schema.resourceKind)
        if (schema.mediaType !== null) {
          expect(operation.resourceContract.outputMediaTypes, operationId)
            .toContain(schema.mediaType)
        }
      }
    }
  })

  it('publishes one MCP Production Manifest as an exact billable file producer', () => {
    const manifest = createProjectAgentOperationRegistryForApi().submit_production_manifest
    expect(manifest).toBeDefined()
    expect(manifest?.channels).toEqual({ tool: true, api: true, mcp: true })
    expect(manifest?.confirmation).toMatchObject({
      kind: 'billable_media',
      required: true,
    })
    expect(manifest?.resourceContract).toMatchObject({
      kind: 'resource',
      outputResourceKinds: ['file'],
      outputMediaTypes: ['image', 'audio', 'video'],
      placement: 'required',
    })
  })

  it('matches the manifest boundary to the durable execution task limit', () => {
    const manifest = createProjectAgentOperationRegistryForApi().submit_production_manifest
    if (!manifest) throw new Error('submit_production_manifest missing')
    const items = Array.from({ length: OPERATION_EXECUTION_MAX_TASKS }, (_, index) => ({
      itemId: `shot-${String(index).padStart(3, '0')}`,
      mediaType: 'video' as const,
      outputPath: `shots/${String(index).padStart(3, '0')}.resource`,
      prompt: `Shot ${index}`,
    }))

    expect(manifest.inputSchema.safeParse({ manifestId: 'feature-film', items }).success).toBe(true)
    expect(manifest.inputSchema.safeParse({
      manifestId: 'feature-film-overflow',
      items: [...items, {
        itemId: `shot-${OPERATION_EXECUTION_MAX_TASKS}`,
        mediaType: 'video',
        outputPath: `shots/${OPERATION_EXECUTION_MAX_TASKS}.resource`,
        prompt: `Shot ${OPERATION_EXECUTION_MAX_TASKS}`,
      }],
    }).success).toBe(false)
  })
})
