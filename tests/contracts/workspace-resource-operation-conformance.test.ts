import { describe, expect, it } from 'vitest'
import { buildWorkspaceCanvasCreateOperationInput } from '@/features/project-workspace/canvas/create/canvas-create-input'
import { readCanvasActionCatalogView } from '@/lib/operations/canvas-action-catalog'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { OPERATION_EXECUTION_MAX_TASKS } from '@/lib/temporal/operation-execution/contracts'
import { parseWorkspaceResourceGenerationTaskPayload } from '@/lib/workspace-resource/generation-contract'
import {
  assetGenerationBatchOutputSchema,
  videoGenerationBatchSchema,
} from '@/lib/workspace-resource/generation-request'
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
        expect(operation.resourceContract.outputResourceKinds, operationId).toContain(schema.resourceKind)
        if (schema.mediaType !== null) {
          expect(operation.resourceContract.outputMediaTypes, operationId).toContain(schema.mediaType)
        }
      }
    }
  })

  it('publishes every media generator directly to MCP and exposes no manifest operation', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    expect(registry.submit_production_manifest).toBeUndefined()
    for (const operationId of ['create_image', 'create_audio', 'create_video', 'generate_voice']) {
      const operation = registry[operationId]
      if (!operation) throw new Error(`Required media operation missing: ${operationId}`)
      expect(operation.channels, operationId).toEqual({ tool: true, api: true, mcp: true })
      expect(operation.confirmation).toMatchObject({ kind: 'billable_media', required: true })
      const published = JSON.stringify(operation.toolInputSchema)
      expect(published, operationId).not.toContain('outputPath')
      expect(published, operationId).not.toContain('modelKey')
      expect(published, operationId).not.toContain('generationOptions')
    }
  })

  it('accepts independent video items and caps their expanded Task count', () => {
    const item = (index: number, count = 1) => ({
      itemId: `shot-${String(index)}`,
      name: `Shot ${String(index)}`,
      mediaType: 'video' as const,
      schemaId: 'project.video_segment' as const,
      prompt: `Generate shot ${String(index)}.`,
      durationSeconds: 15,
      count,
    })
    expect(videoGenerationBatchSchema.safeParse({
      kind: 'new',
      items: Array.from({ length: OPERATION_EXECUTION_MAX_TASKS }, (_, index) => item(index)),
    }).success).toBe(true)
    expect(videoGenerationBatchSchema.safeParse({
      kind: 'new',
      items: [item(0, 6), ...Array.from({ length: OPERATION_EXECUTION_MAX_TASKS - 5 }, (_, index) => item(index + 1))],
    }).success).toBe(false)
  })

  it('requires complete reusable-asset identity and 4:3 parameters', () => {
    const batch = {
      schemaVersion: 1 as const,
      outputKind: 'asset_generation_batch' as const,
      batchId: 'assets-v1',
      decision: 'produce' as const,
      overview: 'One reusable character asset.',
      items: [{
        itemId: 'character-one',
        name: 'Character One',
        mediaType: 'image' as const,
        schemaId: 'project.character_image' as const,
        assetKind: 'character' as const,
        aspectRatio: '4:3' as const,
        aliases: [],
        stableDescription: 'A stable visible character design.',
        consumedByShots: ['scene-1'],
        prompt: 'Complete final character asset prompt.',
        count: 1,
      }],
      assumptions: [],
      warnings: [],
    }
    expect(assetGenerationBatchOutputSchema.safeParse(batch).success).toBe(true)
    expect(assetGenerationBatchOutputSchema.safeParse({
      ...batch,
      items: [{ ...batch.items[0], aspectRatio: '16:9' }],
    }).success).toBe(false)
  })

  it('rejects cross-modality schemas, duplicate positions, paths, and duplicate retry identities', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    const image = registry.create_image
    const video = registry.create_video
    if (!image || !video) throw new Error('Required media operation missing')
    expect(image.inputSchema.safeParse({
      request: { kind: 'new', items: [{
        itemId: 'wrong', name: 'Wrong', mediaType: 'image', schemaId: 'project.video_segment', prompt: 'Wrong.',
      }] },
    }).success).toBe(false)
    expect(video.inputSchema.safeParse({
      request: { kind: 'new', items: [{
        itemId: 'shot', name: 'Shot', mediaType: 'video', schemaId: 'project.video_segment',
        prompt: 'A shot.', durationSeconds: 15, outputPath: 'forbidden',
        references: [
          { resourceId: 'res_a', contentVersion: 1, role: 'reference', position: 0, channel: 'image' },
          { resourceId: 'res_b', contentVersion: 1, role: 'reference', position: 0, channel: 'image' },
        ],
      }] },
    }).success).toBe(false)
    expect(image.inputSchema.safeParse({ request: { kind: 'retry', resourceIds: ['res_a', 'res_a'] } }).success).toBe(false)
  })

  it('keeps the public 16-image reference boundary representable in the frozen Task envelope', () => {
    const references = Array.from({ length: 16 }, (_, position) => ({
      resourceId: `res_${String(position)}`,
      contentVersion: 1,
      role: 'reference',
      position,
      channel: 'image' as const,
    }))
    const image = createProjectAgentOperationRegistryForApi().create_image
    if (!image) throw new Error('create_image missing')
    expect(image.inputSchema.safeParse({ request: { kind: 'new', items: [{
      itemId: 'derived', name: 'Derived', mediaType: 'image', schemaId: 'generic.image',
      assetKind: null, prompt: 'Use every reference.', references,
    }] } }).success).toBe(true)
    expect(() => parseWorkspaceResourceGenerationTaskPayload({
      lifecycleProjection: { resources: [{ resourceId: 'res_output', mediaType: 'image', schemaId: 'generic.image', name: 'Derived' }] },
      protocol: 'workspace_resource_generation_v1',
      resource: {
        resourceId: 'res_output', workspacePath: 'Derived-res_output', mediaType: 'image', schemaId: 'generic.image',
        inputHash: 'a'.repeat(64), prompt: 'Use every reference.', modelKey: 'openrouter::openai/gpt-image-2',
        inputs: references.map((reference) => ({
          resourceId: reference.resourceId,
          contentVersion: reference.contentVersion,
          role: reference.role,
          position: reference.position,
          workspacePath: `ref-${String(reference.position)}`,
        })),
        imageInputPositions: references.map((reference) => reference.position), audioInputPositions: [], videoInputPositions: [],
        toolCallId: null, sourceTurnId: null,
      },
      imageModel: 'openrouter::openai/gpt-image-2', count: 1, generationOptions: {},
    })).not.toThrow()
  })

  it('keeps every server-declared Canvas creation action valid against its live Operation schema', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    for (const capability of readCanvasActionCatalogView().creation) {
      const operation = registry[capability.operationId]
      if (!operation || operation.resourceContract.kind !== 'resource') throw new Error(`Canvas operation missing: ${capability.operationId}`)
      const input = buildWorkspaceCanvasCreateOperationInput({
        capability,
        name: 'Canvas resource',
        prompt: 'Create one coherent project resource.',
        count: capability.alternatives.min,
        durationSeconds: capability.inputLimits.durationSeconds?.min ?? null,
        voicePreviewText: 'This is the voice preview.',
        position: { x: 0, y: 0 },
      }, null)
      expect(operation.inputSchema.safeParse(input).success, capability.operationId).toBe(true)
    }
  })
})
