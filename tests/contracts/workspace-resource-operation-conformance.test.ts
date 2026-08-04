import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { OPERATION_EXECUTION_MAX_TASKS } from '@/lib/temporal/operation-execution/contracts'
import { requireWorkspaceResourceSchema } from '@/lib/workspace-resource/schema-registry'
import { parseWorkspaceResourceGenerationTaskPayload } from '@/lib/workspace-resource/generation-contract'
import { readCanvasActionCatalogView } from '@/lib/operations/canvas-action-catalog'
import { buildWorkspaceCanvasCreateOperationInput } from '@/features/project-workspace/canvas/create/canvas-create-input'
import { productionManifestSchema } from '@/lib/workspace-resource/production-manifest'

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
    expect(manifest?.inputSchema.safeParse({
      manifestPath: 'production/video-manifest.json',
    }).success).toBe(true)
    expect(manifest?.inputSchema.safeParse({
      manifestId: 'inline-manifest-is-forbidden',
      items: [],
    }).success).toBe(false)
  })

  it('keeps direct media creation out of MCP while preserving API/Canvas creation', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    for (const operationId of ['create_image', 'create_audio', 'create_video']) {
      const operation = registry[operationId]
      if (!operation) throw new Error(`Required media operation missing: ${operationId}`)
      expect(operation.channels, operationId).toEqual({ tool: false, api: true, mcp: false })
    }
  })

  it('matches the manifest boundary to the durable execution task limit', () => {
    const manifest = createProjectAgentOperationRegistryForApi().submit_production_manifest
    if (!manifest) throw new Error('submit_production_manifest missing')
    const items = Array.from({ length: OPERATION_EXECUTION_MAX_TASKS }, (_, index) => ({
      itemId: `shot-${String(index).padStart(3, '0')}`,
      mediaType: 'video' as const,
      schemaId: 'project.video_segment' as const,
      outputPath: `shots/${String(index).padStart(3, '0')}.resource`,
      prompt: `Shot ${index}`,
      durationSeconds: 15,
    }))

    expect(productionManifestSchema.safeParse({
      schemaVersion: 1,
      manifestId: 'feature-film',
      items: items.map((item) => ({ ...item, aspectRatio: '16:9' })),
    }).success).toBe(true)
    expect(productionManifestSchema.safeParse({
      schemaVersion: 1,
      manifestId: 'feature-film-overflow',
      items: [...items, {
        itemId: `shot-${OPERATION_EXECUTION_MAX_TASKS}`,
        mediaType: 'video',
        schemaId: 'project.video_segment',
        outputPath: `shots/${OPERATION_EXECUTION_MAX_TASKS}.resource`,
        prompt: `Shot ${OPERATION_EXECUTION_MAX_TASKS}`,
        durationSeconds: 15,
      }].map((item) => ({ ...item, aspectRatio: '16:9' })),
    }).success).toBe(false)
  })

  it('requires complete explicit asset identity and 4:3 execution parameters', () => {
    const base = {
      schemaVersion: 1 as const,
      manifestId: 'assets-v1',
      items: [{
        itemId: 'character-one',
        mediaType: 'image' as const,
        schemaId: 'project.character_image' as const,
        assetKind: 'character' as const,
        outputPath: 'assets/character-one.resource',
        aspectRatio: '4:3',
        prompt: 'Complete final character asset prompt including the required presentation.',
      }],
    }
    expect(productionManifestSchema.safeParse(base).success).toBe(true)
    expect(productionManifestSchema.safeParse({
      ...base,
      items: [{ ...base.items[0], aspectRatio: '16:9' }],
    }).success).toBe(false)
    expect(productionManifestSchema.safeParse({
      ...base,
      items: [{ ...base.items[0], assetKind: 'location' }],
    }).success).toBe(false)
  })

  it('publishes modality-specific media inputs without provider escape hatches', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    const image = registry.create_image
    const audio = registry.create_audio
    const video = registry.create_video
    const voice = registry.generate_voice
    if (!image || !audio || !video || !voice) throw new Error('Required media operation missing')

    for (const operation of [image, audio, video, registry.submit_production_manifest, voice]) {
      if (!operation) throw new Error('Required media operation missing')
      const publishedSchema = JSON.stringify(operation.toolInputSchema)
      expect(publishedSchema, operation.id).not.toContain('"modelKey"')
      expect(publishedSchema, operation.id).not.toContain('"generationOptions"')
      expect(publishedSchema, operation.id).not.toContain('"outputFormat"')
    }

    expect(image.inputSchema.safeParse({
      request: {
        kind: 'new',
        outputPath: 'assets/character.resource',
        schemaId: 'project.character_image',
        prompt: 'An original character wearing a navy utility coat.',
      },
    }).success).toBe(false)
    expect(audio.inputSchema.safeParse({
      request: {
        kind: 'new',
        outputPath: 'audio/theme.resource',
        schemaId: 'project.bgm_audio',
        prompt: 'Restrained industrial ambience with a hopeful ending.',
        durationSeconds: 60,
        vocalMode: 'instrumental',
      },
    }).success).toBe(true)
    expect(video.inputSchema.safeParse({
      request: {
        kind: 'new',
        outputPath: 'shots/001.resource',
        schemaId: 'project.video_segment',
        prompt: 'A slow push through an abandoned underground station.',
        durationSeconds: 15,
      },
    }).success).toBe(true)
    expect(image.inputSchema.safeParse({
      request: {
        kind: 'new',
        outputPath: 'assets/ambiguous.resource',
        prompt: 'The server must not guess whether this is a reusable asset.',
      },
    }).success).toBe(false)

    for (const operation of [image, audio, video, voice]) {
      expect(operation.inputSchema.safeParse({
        request: {
          kind: 'new',
          outputPath: 'escape.resource',
          prompt: 'Do something.',
          durationSeconds: 15,
          modelKey: 'provider::model',
          generationOptions: { aspectRatio: '99:1' },
          outputFormat: 'arbitrary',
        },
        outputPath: 'escape.resource',
        text: 'Do something.',
        modelKey: 'provider::model',
        generationOptions: {},
      }).success, operation.id).toBe(false)
    }
  })

  it('rejects cross-modality schemas, duplicate input positions, and duplicate retry identities', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    const image = registry.create_image
    const video = registry.create_video
    if (!image || !video) throw new Error('Required media operation missing')

    expect(image.inputSchema.safeParse({
      request: {
        kind: 'new',
        outputPath: 'assets/not-an-image.resource',
        schemaId: 'project.video_segment',
        prompt: 'Wrong modality.',
      },
    }).success).toBe(false)
    expect(video.inputSchema.safeParse({
      request: {
        kind: 'new',
        outputPath: 'shots/001.resource',
        schemaId: 'project.video_segment',
        prompt: 'A generated shot.',
        durationSeconds: 15,
        references: [
          {
            resourceId: 'res_a', contentVersion: 1, workspacePath: 'assets/a.resource',
            role: 'reference', position: 0, channel: 'image',
          },
          {
            resourceId: 'res_b', contentVersion: 1, workspacePath: 'assets/b.resource',
            role: 'reference', position: 0, channel: 'image',
          },
        ],
      },
    }).success).toBe(false)
    expect(image.inputSchema.safeParse({
      request: { kind: 'retry', resourceIds: ['res_a', 'res_a'] },
    }).success).toBe(false)
  })

  it('keeps the public 16-image reference boundary representable in the frozen Task envelope', () => {
    const image = createProjectAgentOperationRegistryForApi().create_image
    if (!image) throw new Error('create_image missing')
    const references = Array.from({ length: 16 }, (_, position) => ({
      resourceId: `res_${String(position)}`,
      contentVersion: 1,
      workspacePath: `assets/ref-${String(position)}.resource`,
      role: 'reference',
      position,
      channel: 'image' as const,
    }))
    expect(image.inputSchema.safeParse({
      request: {
        kind: 'new',
        outputPath: 'assets/derived.resource',
        schemaId: 'generic.image',
        prompt: 'Use every declared reference.',
        references,
      },
    }).success).toBe(true)

    expect(() => parseWorkspaceResourceGenerationTaskPayload({
      lifecycleProjection: {
        resources: [{
          resourceId: 'res_output',
          mediaType: 'image',
          schemaId: 'generic.image',
          name: 'derived',
        }],
      },
      protocol: 'workspace_resource_generation_v1',
      resource: {
        resourceId: 'res_output',
        workspacePath: 'assets/derived.resource',
        mediaType: 'image',
        schemaId: 'generic.image',
        inputHash: 'a'.repeat(64),
        prompt: 'Use every declared reference.',
        modelKey: 'openrouter::openai/gpt-image-2',
        inputs: references.map((reference) => ({
          resourceId: reference.resourceId,
          contentVersion: reference.contentVersion,
          workspacePath: reference.workspacePath,
          role: reference.role,
          position: reference.position,
        })),
        imageInputPositions: references.map((reference) => reference.position),
        audioInputPositions: [],
        videoInputPositions: [],
        toolCallId: null,
        sourceTurnId: null,
      },
      imageModel: 'openrouter::openai/gpt-image-2',
      count: 1,
      generationOptions: {},
    })).not.toThrow()
  })

  it('keeps every server-declared Canvas creation action valid against its live Operation schema', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    for (const capability of readCanvasActionCatalogView().creation) {
      const operation = registry[capability.operationId]
      if (!operation || operation.resourceContract.kind !== 'resource') {
        throw new Error(`Canvas operation missing: ${capability.operationId}`)
      }
      expect(operation.resourceContract.outputSchemaIds, capability.operationId)
        .toContain(capability.defaultSchemaId)
      const duration = capability.inputLimits.durationSeconds?.min ?? null
      const input = buildWorkspaceCanvasCreateOperationInput({
        capability,
        name: 'Canvas resource',
        prompt: 'Create one coherent project resource.',
        count: capability.alternatives.min,
        durationSeconds: duration,
        voicePreviewText: 'This is the voice preview.',
        position: { x: 0, y: 0 },
      }, 'canvas/resource.resource')
      expect(operation.inputSchema.safeParse(input).success, capability.operationId).toBe(true)
    }
  })
})
