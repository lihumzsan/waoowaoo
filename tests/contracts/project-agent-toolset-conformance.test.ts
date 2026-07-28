import fs from 'node:fs'
import path from 'node:path'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import {
  CREATIVE_SKILL_IDS,
  CREATIVE_SKILL_REGISTRY,
  readCreativeSkillResource,
} from '@/lib/creative-skills'
import {
  CREATIVE_WORK_TASK_PROTOCOL,
  CREATIVE_WORK_OUTPUT_KINDS,
  creativeWorkOutputRegistry,
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
  buildCreativeWorkerSystemPrompt,
  projectAdoptedCreativeDirection,
} from '@/lib/creative-worker'
import { createCreativeWorkerTools } from '@/lib/creative-worker/tools'
import { listCreativeWorkerSkillCatalog } from '@/lib/creative-worker/skill-access'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { normalizeProjectAgentToolInput } from '@/lib/operations/tool-input-schema'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'
import {
  PROJECT_AGENT_TOOL_CATALOG_DESCRIPTION_LIMIT,
  createProjectAgentToolCatalog,
} from '@/lib/project-agent/tool-discovery'
import {
  CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA,
  CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA,
} from '@/lib/creative-resource/schema-registry'
import { resolveAssetImageKindForSchemaId } from '@/lib/asset-generation'
import { ASPECT_RATIO_CONFIGS } from '@/lib/constants'

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function collectDiscriminatorBranches(
  value: unknown,
  key: string,
): Record<string, unknown>[] {
  const branches: Record<string, unknown>[] = []
  const visit = (candidate: unknown): void => {
    const record = readRecord(candidate)
    const properties = readRecord(record.properties)
    if (Object.prototype.hasOwnProperty.call(readRecord(properties[key]), 'const')) {
      branches.push(record)
    }
    for (const unionKey of ['oneOf', 'anyOf'] as const) {
      const union = record[unionKey]
      if (Array.isArray(union)) union.forEach(visit)
    }
  }
  visit(value)
  return branches
}

function collectUnboundedSchemaNodes(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnboundedSchemaNodes(item, `${path}/${String(index)}`, out))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = readRecord(value)
  if (Object.keys(record).length === 0) {
    out.push(path)
    return
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'default') continue
    collectUnboundedSchemaNodes(child, `${path}/${key}`, out)
  }
}

function collectNullableEnumViolations(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNullableEnumViolations(item, `${path}/${String(index)}`, out))
    return
  }
  const record = readRecord(value)
  const types = Array.isArray(record.type) ? record.type : []
  if (types.includes('null') && Array.isArray(record.enum) && !record.enum.includes(null)) {
    out.push(path)
  }
  for (const [key, child] of Object.entries(record)) {
    collectNullableEnumViolations(child, `${path}/${key}`, out)
  }
}

describe('project agent toolset conformance', () => {
  it('derives every tool-authorized capability from the production registry', () => {
    const registry = createProjectAgentOperationRegistry()
    const expectedOperationIds = Object.values(registry)
      .filter((operation) => operation.channels.tool)
      .map((operation) => operation.id)
      .sort()

    const toolset = resolveProjectAgentToolset({ registry })

    expect(toolset.source).toBe('operation-registry')
    expect(toolset.disabledOperationIds).toEqual([])
    expect(toolset.operationIds).toEqual(expectedOperationIds)
    expect(toolset.directOperationIds).toEqual([
      'get_project_context',
      'get_resource',
      'request_choice',
      'update_plan',
    ])
    expect(toolset.onDemandOperationIds).toEqual(
      expectedOperationIds.filter((operationId) => !toolset.directOperationIds.includes(operationId)),
    )
    for (const operationId of toolset.directOperationIds) {
      expect(registry[operationId]?.toolExposure).toBe('direct')
    }
    expect(toolset.operationIds).not.toContain('get_user_api_config')
    expect(toolset.operationIds).not.toContain('put_user_api_config')
    expect(toolset.operationIds).not.toContain('get_user_preference')
    expect(toolset.operationIds).not.toContain('update_user_preference')
    expect(toolset.operationIds).not.toContain('list_user_models')
    expect(toolset.operationIds).not.toContain('get_project_config')
    expect(toolset.operationIds).not.toContain('list_projects')
    expect(toolset.operationIds).not.toContain('create_project')
    expect(toolset.operationIds).not.toContain('get_project_basic')
    expect(toolset.operationIds).not.toContain('get_project_data')
    expect(toolset.operationIds).not.toContain('get_task_status')
    expect(toolset.operationIds).not.toContain('list_user_transactions')
    expect(toolset.operationIds).not.toContain('get_user_costs')
    expect(toolset.operationIds).toContain('update_project_config')
    expect(registry.get_user_api_config.channels).toEqual({ tool: false, api: true })
    expect(registry.put_user_api_config.channels).toEqual({ tool: false, api: true })
    expect(registry.get_user_preference.channels).toEqual({ tool: false, api: true })
    expect(registry.update_user_preference.channels).toEqual({ tool: false, api: true })
    expect(registry.list_user_models.channels).toEqual({ tool: false, api: true })
    expect(registry.get_project_config.channels).toEqual({ tool: false, api: true })
    expect(registry.list_projects.channels).toEqual({ tool: false, api: true })
    expect(registry.create_project.channels).toEqual({ tool: false, api: true })
    expect(registry.get_project_basic.channels).toEqual({ tool: false, api: true })
    expect(registry.get_project_data.channels).toEqual({ tool: false, api: true })
    expect(registry.get_task_status.channels).toEqual({ tool: false, api: true })
    expect(registry.list_user_transactions.channels).toEqual({ tool: false, api: true })
    expect(registry.get_user_costs.channels).toEqual({ tool: false, api: true })
    for (const retiredOperationId of [
      'dismiss_failed_tasks',
      'get_task_batch',
      'list_recent_mutation_batches',
      'select_asset_render',
      'update_character_appearance_description',
      'update_location_image_description',
      'cleanup_unselected_images',
      'copy_asset_from_global',
      'revert_asset_render',
      'revert_mutation_batch',
      'revert_mutation_batch_by_id',
    ]) {
      expect(registry[retiredOperationId]).toBeUndefined()
    }
    expect(registry.update_project_config.channels).toEqual({ tool: true, api: true })
    expect(registry.update_project_config.choiceCommit).toEqual({ enabled: true })
    expect(Object.keys(registry.update_project_config.toolInputSchema.properties)).toEqual(['videoRatio'])
    expect(registry.update_project_config.toolInputSchema.properties.videoRatio).toMatchObject({
      type: 'string',
      enum: Object.keys(ASPECT_RATIO_CONFIGS),
    })
    expect(registry.update_project_config.inputSchema.safeParse({ videoRatio: '16:9' }).success).toBe(true)
    expect(registry.update_project_config.inputSchema.safeParse({ videoRatio: null }).success).toBe(false)
  })

  it('projects the exhaustive registry into compact discovery text and canonical load definitions', () => {
    const registry = createProjectAgentOperationRegistry()
    const toolset = resolveProjectAgentToolset({ registry })
    const catalog = createProjectAgentToolCatalog({ registry, toolset })

    expect(catalog.map((entry) => entry.operationId)).toEqual(toolset.onDemandOperationIds)
    for (const entry of catalog) {
      expect(Object.keys(entry).sort()).toEqual(['description', 'groupPath', 'operationId', 'parameters'])
      expect(entry.groupPath.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeLessThanOrEqual(PROJECT_AGENT_TOOL_CATALOG_DESCRIPTION_LIMIT)
      expect(entry.parameters).toBe(registry[entry.operationId]?.toolInputSchema)
    }
  })

  it('keeps structural plan and creative-delegation model inputs inside their runtime contracts', () => {
    const registry = createProjectAgentOperationRegistry()
    const ajv = new Ajv({ allErrors: true, jsonPointers: true })
    const acceptedSamples = [
      {
        operationId: 'update_plan',
        input: {
          explanation: 'Track the remaining implementation work.',
          plan: {
            state: 'active',
            completed: ['Inspect the canonical contract'],
            active: 'Replace the hidden refinement',
            pending: ['Run conformance'],
          },
        },
      },
      {
        operationId: 'update_plan',
        input: {
          explanation: null,
          plan: {
            state: 'pending',
            completed: [],
            pending: ['Wait for the required external input'],
          },
        },
      },
      {
        operationId: 'update_plan',
        input: {
          explanation: 'Everything is complete.',
          plan: {
            state: 'completed',
            completed: ['Implement the contract', 'Verify the contract'],
          },
        },
      },
      {
        operationId: 'update_plan',
        input: {
          explanation: null,
          plan: { state: 'clear' },
        },
      },
      {
        operationId: 'delegate_creative_work',
        input: {
          delegation: {
            source: 'requests',
            requests: [{
              requestKey: 'video-request',
              outputKind: 'video_prompt_set',
              goal: 'Design the executable video prompts.',
              durationIntent: { mode: 'derive' },
              context: {
                userRequest: 'Create this scene.',
                sourceMaterials: [],
                constraints: [],
              },
            }],
          },
        },
      },
      {
        operationId: 'delegate_creative_work',
        input: {
          delegation: {
            source: 'chapters',
            chapters: [{
              chapterId: 'chapter-1',
              requestKey: 'chapter-video',
              durationIntent: { mode: 'fixed', seconds: 60 },
            }],
            outputKind: 'video_prompt_set',
            goal: 'Design this Chapter as executable video prompts.',
            userRequest: 'Create the complete story.',
            constraints: [],
            referencedAssets: [],
          },
        },
      },
      {
        operationId: 'delegate_creative_work',
        input: {
          delegation: {
            source: 'requests',
            requests: [{
              requestKey: 'screenplay-request',
              outputKind: 'screenplay',
              goal: 'Write the screenplay.',
              durationIntent: null,
              context: {
                userRequest: 'Write a short screenplay.',
                sourceMaterials: [],
                constraints: [],
              },
            }],
          },
        },
      },
    ] as const

    for (const sample of acceptedSamples) {
      const operation = registry[sample.operationId]
      const validateModelInput = ajv.compile(operation.toolInputSchema)
      expect(
        validateModelInput(sample.input),
        `${sample.operationId}: ${JSON.stringify(validateModelInput.errors)}`,
      ).toBe(true)
      const normalized = normalizeProjectAgentToolInput({
        input: sample.input,
        inputSchema: operation.inputSchema,
        toolInputSchema: operation.toolInputSchema,
      })
      expect(operation.inputSchema.safeParse(normalized).success, sample.operationId).toBe(true)
    }

    const rejectedCounterexamples = [
      {
        operationId: 'update_plan',
        input: {
          explanation: 'The former shape could express two active steps.',
          plan: [
            { step: 'First active step', status: 'in_progress' },
            { step: 'Second active step', status: 'in_progress' },
          ],
        },
      },
      {
        operationId: 'update_plan',
        input: {
          explanation: '',
          plan: { state: 'clear' },
        },
      },
      {
        operationId: 'delegate_creative_work',
        input: {
          delegation: {
            source: 'requests',
            requests: [{
              requestKey: 'missing-request-duration',
              outputKind: 'video_prompt_set',
              goal: 'Design the video.',
              context: { userRequest: 'Create it.', sourceMaterials: [], constraints: [] },
            }],
          },
        },
      },
      {
        operationId: 'delegate_creative_work',
        input: {
          delegation: {
            source: 'chapters',
            chapters: [{ chapterId: 'chapter-1', requestKey: 'missing-chapter-duration' }],
            outputKind: 'video_prompt_set',
            goal: 'Design the Chapter video.',
            userRequest: 'Create it.',
            constraints: [],
            referencedAssets: [],
          },
        },
      },
    ] as const

    for (const sample of rejectedCounterexamples) {
      const operation = registry[sample.operationId]
      const validateModelInput = ajv.compile(operation.toolInputSchema)
      expect(validateModelInput(sample.input), sample.operationId).toBe(false)
    }
  })

  it('publishes the runtime http(s) URL contract for web-reference imports', () => {
    const operation = createProjectAgentOperationRegistry().import_web_reference_image
    const imageUrlSchema = readRecord(operation.toolInputSchema.properties.imageUrl)
    const protocolBranches = Array.isArray(imageUrlSchema.anyOf)
      ? imageUrlSchema.anyOf.map(readRecord)
      : []

    expect(protocolBranches).toHaveLength(2)
    expect(protocolBranches.map((branch) => branch.format)).toEqual(['uri', 'uri'])
    expect(protocolBranches.map((branch) => branch.maxLength)).toEqual([2_000, 2_000])
    expect(protocolBranches.map((branch) => branch.pattern)).toEqual([
      '^http:\\/\\/.*',
      '^https:\\/\\/.*',
    ])

    const validateModelInput = new Ajv({ allErrors: true, jsonPointers: true })
      .compile(operation.toolInputSchema)
    const httpsInput = {
      imageUrl: 'https://images.example.test/reference.png',
      sourceWebsiteUrl: 'https://example.test/source',
      name: 'Reference image',
      caption: null,
    }
    const ftpInput = {
      ...httpsInput,
      imageUrl: 'ftp://images.example.test/reference.png',
    }
    const malformedHttpInput = {
      ...httpsInput,
      imageUrl: 'https://invalid host.example/reference.png',
    }
    const oversizedHttpInput = {
      ...httpsInput,
      imageUrl: `https://images.example.test/${'a'.repeat(2_000)}`,
    }

    expect(validateModelInput(httpsInput)).toBe(true)
    expect(operation.inputSchema.safeParse(httpsInput).success).toBe(true)
    expect(validateModelInput(ftpInput)).toBe(false)
    expect(operation.inputSchema.safeParse(ftpInput).success).toBe(false)
    expect(validateModelInput(malformedHttpInput)).toBe(false)
    expect(operation.inputSchema.safeParse(malformedHttpInput).success).toBe(false)
    expect(validateModelInput(oversizedHttpInput)).toBe(false)
    expect(operation.inputSchema.safeParse(oversizedHttpInput).success).toBe(false)
  })

  it('can suppress only explicitly named continuation-local tools without changing registry authority', () => {
    const registry = createProjectAgentOperationRegistry()
    const disabledOperationId = Object.values(registry)
      .find((operation) => operation.channels.tool)?.id
    if (!disabledOperationId) throw new Error('TOOL_OPERATION_REQUIRED')

    const toolset = resolveProjectAgentToolset({
      registry,
      disabledOperationIds: [disabledOperationId],
    })

    expect(toolset.disabledOperationIds).toEqual([disabledOperationId])
    expect(toolset.operationIds).not.toContain(disabledOperationId)
    expect(toolset.directOperationIds).not.toContain(disabledOperationId)
    expect(toolset.onDemandOperationIds).not.toContain(disabledOperationId)
    expect(toolset.operationIds).toEqual(
      Object.values(registry)
        .filter((operation) => operation.channels.tool && operation.id !== disabledOperationId)
        .map((operation) => operation.id)
        .sort(),
    )
  })

  it('exposes voice generation and binding without model or provider knobs', () => {
    const registry = createProjectAgentOperationRegistry()
    expect(registry.generate_voice).toMatchObject({
      channels: { tool: true, api: true },
      effects: { billable: true, longRunning: true },
      confirmation: { kind: 'billable_media', required: true },
    })
    const generateProperties = registry.generate_voice.toolInputSchema.properties
    expect(Object.keys(generateProperties).sort()).toEqual([
      'description',
      'language',
      'previewText',
      'resource',
      'target',
    ])
    expect(Object.keys(generateProperties)).not.toEqual(expect.arrayContaining([
      'model',
      'modelKey',
      'provider',
      'temperature',
      'seed',
    ]))
    expect(registry.generate_voice.inputSchema.safeParse({
      description: 'Warm, mature, low register, calm and precise.',
      previewText: '欢迎回来。',
      language: 'Chinese',
      resource: { kind: 'new' },
      target: { kind: 'character', characterId: 'character-1' },
    }).success).toBe(true)
    expect(registry.generate_voice.inputSchema.safeParse({
      description: 'Warm, mature, low register, calm and precise.',
      previewText: 'Welcome back.',
      language: 'English',
      resource: { kind: 'new', name: 'Warm narrator' },
      target: { kind: 'standalone' },
    }).success).toBe(true)
    expect(registry.generate_voice.inputSchema.safeParse({
      description: 'Warm voice',
      previewText: 'Hello.',
      language: 'English',
      resource: { kind: 'regenerate', resourceId: 'voice-resource-1' },
      target: { kind: 'standalone' },
    }).success).toBe(false)
    expect(registry.generate_voice.inputSchema.safeParse({
      description: 'Warm voice',
      previewText: 'Hello.',
      language: 'English',
      resource: { kind: 'new' },
      modelKey: 'fal::other-model',
      target: { kind: 'standalone' },
    }).success).toBe(false)

    expect(registry.bind_voice).toMatchObject({
      channels: { tool: true, api: true },
      effects: { billable: false, overwrite: true },
      confirmation: { kind: 'none', required: false },
    })
    expect(registry.bind_voice.inputSchema.safeParse({
      characterId: 'character-1',
      selection: {
        kind: 'voice',
        resourceId: 'voice-resource-1',
      },
    }).success).toBe(true)
    expect(registry.bind_voice.inputSchema.safeParse({
      characterId: 'character-1',
      selection: { kind: 'none' },
    }).success).toBe(true)
  })

  it('publishes one explicit Resource generation contract from the production registry', () => {
    const registry = createProjectAgentOperationRegistry()
    const textProperties = registry.create_text.toolInputSchema.properties
    expect(Object.keys(textProperties)).not.toContain('schemaId')
    expect(registry.create_text.resourceContract).toEqual({
      kind: 'resource',
      assistantPresentation: 'created_resources',
      acceptsReferences: true,
      outputMediaTypes: ['text'],
      outputSchemaIds: ['generic.text', 'project.screenplay'],
      supportsCandidates: true,
    })
    expect(CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.text).toEqual([
      'generic.text',
      'project.screenplay',
      'project.story_canon',
      'project.chapter_plan',
      'project.continuity_analysis',
      'project.creative_direction',
      'project.asset_manifest',
      'project.video_prompt_set',
      'project.music_direction',
    ])
    expect(Object.keys(textProperties)).not.toContain('generationOptions')
    expect(Object.keys(textProperties)).not.toContain('modelKey')

    for (const [operationId, mediaType] of [
      ['create_image', 'image'],
      ['create_audio', 'audio'],
      ['create_video', 'video'],
    ] as const) {
      const properties = registry[operationId].toolInputSchema.properties
      expect(Object.keys(properties)).toEqual(['request'])
      const requestSchema = readRecord(properties.request)
      const branches = collectDiscriminatorBranches(requestSchema, 'kind')
      const newBranches = branches.filter((branch) => (
        readRecord(readRecord(branch.properties).kind).const === 'new'
      ))
      const retryBranch = branches.find((branch) => (
        readRecord(readRecord(branch.properties).kind).const === 'retry'
      ))
      const modelSelectedSchemaIds = mediaType === 'image'
        ? CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.image.filter(
            (schemaId) => resolveAssetImageKindForSchemaId(schemaId) === null,
          )
        : CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA[mediaType]
      expect(newBranches.length).toBeGreaterThan(0)
      for (const newBranch of newBranches) {
        if (mediaType === 'audio') {
          expect(Object.keys(readRecord(newBranch.properties))).not.toContain('schemaId')
        } else {
          expect(readRecord(readRecord(newBranch).properties).schemaId).toMatchObject({
            enum: [...modelSelectedSchemaIds, null],
          })
        }
        expect(Object.keys(readRecord(newBranch.properties))).not.toEqual(expect.arrayContaining([
          'generationOptions', 'retryResourceIds', 'modelKey',
        ]))
      }
      expect(Object.keys(readRecord(readRecord(retryBranch).properties))).toEqual(['kind', 'resourceIds'])
    }

    expect(Object.keys(registry.create_text.toolInputSchema.properties)).toContain('content')
    expect(Object.keys(registry.create_image.toolInputSchema.properties)).toContain('request')
    expect(Object.keys(registry.create_audio.toolInputSchema.properties)).toContain('request')
    expect(Object.keys(registry.create_text.toolInputSchema.properties)).toContain('contextReferences')
    expect(Object.keys(registry.create_text.toolInputSchema.properties)).not.toContain('imageReferences')
    const videoNewBranches = collectDiscriminatorBranches(
      registry.create_video.toolInputSchema.properties.request,
      'kind',
    ).filter((branch) => readRecord(readRecord(branch.properties).kind).const === 'new')
    expect(videoNewBranches).toHaveLength(2)
    expect(videoNewBranches.some((branch) => (
      Object.keys(readRecord(branch.properties)).includes('audioReferences')
    ))).toBe(true)
    for (const branch of videoNewBranches) {
      const videoNewProperties = readRecord(branch.properties)
      expect(Object.keys(videoNewProperties)).toContain('imageReferences')
      expect(Object.keys(videoNewProperties)).not.toContain('mediaReferences')
      expect(Object.keys(videoNewProperties)).not.toContain('voiceReferenceKeys')
      expect(Object.keys(videoNewProperties)).not.toContain('fps')
    }

    expect(registry.create_text.inputSchema.safeParse({
      prompt: 'Write one line.',
      content: { kind: 'single', text: 'One line.' },
    }).success).toBe(true)
    expect(registry.create_text.inputSchema.safeParse({
      name: 'User screenplay',
      prompt: 'Persist the screenplay supplied in the current user turn.',
      content: {
        kind: 'current_user_text',
        scope: 'project',
        classification: {
          kind: 'screenplay',
          title: 'User screenplay',
        },
        text: 'INT. ROOM - DAY',
      },
    }).success).toBe(true)
    expect(registry.create_text.inputSchema.safeParse({
      schemaId: 'project.screenplay',
      prompt: 'Write a screenplay.',
      content: { kind: 'single', text: 'INT. ROOM - DAY' },
    }).success).toBe(false)
    expect(registry.create_image.inputSchema.safeParse({
      request: { kind: 'new', count: 2, prompt: 'A paper lantern in fog.' },
    }).success).toBe(true)
    const imageRequestSchema = readRecord(registry.create_image.toolInputSchema.properties.request)
    const imageRequestBranches = (Array.isArray(imageRequestSchema.oneOf) ? imageRequestSchema.oneOf : [])
      .map(readRecord)
    const imageAssetBranch = imageRequestBranches.find((branch) => (
      readRecord(readRecord(branch.properties).kind).const === 'asset'
    ))
    const imageAssetProperties = readRecord(readRecord(imageAssetBranch).properties)
    expect(Object.keys(imageAssetProperties)).toEqual([
      'kind',
      'name',
      'prompt',
      'contextReferences',
      'imageReferences',
      'assetBinding',
    ])
    expect(Object.keys(imageAssetProperties)).not.toEqual(expect.arrayContaining([
      'episodeId',
      'count',
      'schemaId',
      'aspectRatio',
      'resolution',
      'quality',
      'size',
    ]))
    expect(registry.create_image.inputSchema.safeParse({
      request: {
        kind: 'asset',
        prompt: 'A precise reference portrait.',
        assetBinding: {
          assetKind: 'character',
          assetId: 'character-1',
          variantId: 'appearance-1',
          expectedVersion: null,
        },
      },
    }).success).toBe(true)
    expect(registry.create_image.inputSchema.safeParse({
      request: {
        kind: 'asset',
        prompt: 'A precise reference portrait.',
        aspectRatio: '16:9',
        assetBinding: {
          assetKind: 'character',
          assetId: 'character-1',
          variantId: 'appearance-1',
          expectedVersion: null,
        },
      },
    }).success).toBe(false)
    expect(registry.create_audio.inputSchema.safeParse({
      request: { kind: 'new', prompt: 'Sparse ritual drums.', durationSeconds: 15 },
    }).success).toBe(true)
    expect(registry.create_audio.inputSchema.safeParse({
      request: { kind: 'new', count: 2, prompt: 'Sparse ritual drums.', durationSeconds: 15 },
    }).success).toBe(false)
    expect(registry.create_audio.inputSchema.safeParse({
      request: { kind: 'new', prompt: 'Sparse ritual drums.', durationSeconds: 15, schemaId: 'project.bgm_audio' },
    }).success).toBe(false)
    expect(registry.create_audio.resourceContract).toMatchObject({
      supportsCandidates: false,
      outputSchemaIds: ['project.bgm_audio'],
    })
    expect(CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.audio).toEqual(['project.bgm_audio'])
    expect(registry.create_video.inputSchema.safeParse({
      request: {
        kind: 'new',
        count: 1,
        prompt: 'A slow push toward a moonlit shrine.',
        durationSeconds: 15,
      },
    }).success).toBe(true)
    expect(registry.create_video.inputSchema.safeParse({
      request: {
        kind: 'prompt_set',
        resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA',
      },
    }).success).toBe(true)
    expect(registry.create_video.inputSchema.safeParse({
      request: {
        kind: 'prompt_set',
        resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA',
        prompt: 'Primary must not copy the stored segment prompt.',
      },
    }).success).toBe(false)
    expect(registry.create_video.inputSchema.safeParse({
      request: {
        kind: 'prompt_set',
        resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA',
        imageReferences: [{ resourceId: 'r_BBBBBBBBBBBBBBBBBBBBBB' }],
      },
    }).success).toBe(false)
    expect(registry.create_video.inputSchema.safeParse({
      request: {
        kind: 'new',
        count: 1,
        prompt: 'A slow push toward a moonlit shrine.',
        fps: 24,
      },
    }).success).toBe(false)
    expect(registry.create_video.inputSchema.safeParse({
      request: { kind: 'retry', resourceIds: ['failed-video-resource'] },
    }).success).toBe(true)
    expect(registry.create_video.inputSchema.safeParse({
      request: {
        kind: 'retry',
        resourceIds: ['failed-video-resource'],
        prompt: 'This must never replace the frozen video prompt.',
        imageReferences: [],
      },
    }).success).toBe(false)
    expect(registry.create_video.inputSchema.safeParse({
      prompt: 'Old provider-shaped input.',
      count: 1,
      generationOptions: { durationSeconds: 15 },
    }).success).toBe(false)
    expect(registry.create_video.inputSchema.safeParse({
      prompt: 'Agent-selected model input.',
      modelKey: 'provider::model',
      request: { kind: 'new', count: 1, prompt: 'Nested prompt.', durationSeconds: 15 },
    }).success).toBe(false)
    expect(registry.create_image.inputSchema.safeParse({
      request: { kind: 'new', count: 1, prompt: 'Legacy ambiguous reference input.' },
      references: [],
    }).success).toBe(false)
  })

  it('publishes exact retry and task branches without Agent model configuration', () => {
    const registry = createProjectAgentOperationRegistry()
    const requestSchema = readRecord(registry.create_video.toolInputSchema.properties.request)
    const requestKinds = collectDiscriminatorBranches(requestSchema, 'kind')
      .map((branch) => readRecord(readRecord(branch.properties).kind).const)
    expect(Array.from(new Set(requestKinds))).toEqual(['new', 'prompt_set', 'retry'])

    expect(Object.keys(registry.list_tasks.toolInputSchema.properties)).toEqual(expect.arrayContaining([
      'targetType', 'targetId', 'status', 'type', 'limit',
    ]))
    expect(Object.keys(registry.get_task.toolInputSchema.properties)).toEqual([
      'taskId', 'events',
    ])
    expect(registry.get_task.inputSchema.safeParse({
      taskId: 'task-1',
      events: { kind: 'none' },
    }).success).toBe(true)
    expect(registry.get_task.inputSchema.safeParse({
      taskId: 'task-1',
      events: { kind: 'include', limit: 10 },
    }).success).toBe(true)
    expect(registry.get_task.inputSchema.safeParse({
      taskId: 'task-1',
      events: { kind: 'none', limit: 10 },
    }).success).toBe(false)
  })

  it('uses exact immutable Resources for Story Canon and Creative Direction adoption', () => {
    const registry = createProjectAgentOperationRegistry()

    expect(registry.adopt_story_canon.channels.tool).toBe(true)
    expect(Object.keys(registry.adopt_story_canon.toolInputSchema.properties)).toEqual([
      'screenplay', 'storyCanon', 'expectedVersion',
    ])
    expect(registry.adopt_story_canon.inputSchema.safeParse({
      screenplay: {
        resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA',
      },
      storyCanon: {
        resourceId: 'r_BBBBBBBBBBBBBBBBBBBBBB',
      },
      expectedVersion: null,
    }).success).toBe(true)

    expect(registry.adopt_creative_direction.inputSchema.safeParse({
      resourceId: 'r_CCCCCCCCCCCCCCCCCCCCCC',
      expectedVersion: null,
    }).success).toBe(true)
    expect(registry.adopt_creative_direction.inputSchema.safeParse({
      resourceId: 'resource:style',
      fingerprint: 'caller-owned',
      expectedVersion: null,
    }).success).toBe(false)
  })

  it('exposes one cautious schema-open Resource creative-data editor', () => {
    const operation = createProjectAgentOperationRegistry().edit_resource

    expect(operation.channels.tool).toBe(true)
    expect(operation.effects).toMatchObject({
      writes: true,
      billable: false,
      externalSideEffects: false,
      longRunning: false,
    })
    expect(Object.keys(operation.toolInputSchema.properties)).toEqual([
      'resourceId', 'expectedVersion', 'reason', 'edits',
    ])
    expect(operation.inputSchema.safeParse({
      resourceId: 'resource:video',
      expectedVersion: 0,
      reason: 'The user explicitly requested saving corrected production data.',
      edits: [{
        op: 'set',
        path: ['video', 'futureCapability'],
        valueJson: JSON.stringify({ arbitrary: ['typed', 'json'] }),
      }],
    }).success).toBe(true)
    expect(operation.inputSchema.safeParse({
      resourceId: 'resource:video',
      expectedVersion: 0,
      reason: 'Try to mutate system state.',
      status: 'ready',
      edits: [],
    }).success).toBe(false)
  })

  it('exposes one background Creative Worker delegation contract without domain write authority', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.delegate_creative_work

    expect(operation).toBeDefined()
    expect(operation.channels).toEqual({ tool: true, api: false })
    expect(operation.groupPath).toEqual(['assistant', 'creative'])
    expect(operation.intent).toBe('act')
    expect(operation.confirmation).toMatchObject({ kind: 'none', required: false })
    expect(operation.effects).toEqual({
      writes: true,
      workspaceResourceImpact: 'none',
      billable: false,
      destructive: false,
      overwrite: false,
      bulk: true,
      externalSideEffects: true,
      longRunning: true,
    })
    expect(Object.keys(operation.toolInputSchema.properties)).toEqual(['delegation'])
    const delegationSchema = readRecord(operation.toolInputSchema.properties.delegation)
    const sourceBranches = Array.isArray(delegationSchema.anyOf) ? delegationSchema.anyOf.map(readRecord) : []
    expect(readRecord(readRecord(sourceBranches[0]).properties).source).toMatchObject({
      const: 'requests',
    })
    const chapterBranches = sourceBranches.slice(1)
    expect(chapterBranches).toHaveLength(CREATIVE_WORK_OUTPUT_KINDS.length)
    expect(chapterBranches.every((branch) => (
      readRecord(readRecord(branch.properties).source).const === 'chapters'
    ))).toBe(true)
    expect(chapterBranches.map((branch) => (
      readRecord(readRecord(branch.properties).outputKind).const
    ))).toEqual([
      'video_prompt_set',
      ...CREATIVE_WORK_OUTPUT_KINDS.filter((kind) => kind !== 'video_prompt_set'),
    ])
    expect(operation.inputSchema.safeParse({
      delegation: {
        source: 'requests',
        requests: [{
          requestKey: 'short-video-1',
          outputKind: 'video_prompt_set',
          goal: 'Design the complete requested video.',
          durationIntent: { mode: 'fixed', seconds: 60 },
          context: {
            userRequest: 'A lantern wakes in an abandoned shrine.',
            sourceMaterials: [],
            constraints: ['Preserve the same lantern identity throughout.'],
          },
        }],
      },
    }).success).toBe(true)
    expect(operation.inputSchema.safeParse({
      delegation: { source: 'requests', requests: [] },
    }).success).toBe(false)
    const exactResourceRequest = {
      delegation: {
        source: 'requests' as const,
        requests: [{
          requestKey: 'revise-provided-screenplay',
          outputKind: 'screenplay' as const,
          goal: 'Revise the supplied screenplay.',
          context: {
            userRequest: 'Use my screenplay.',
            sourceMaterials: [{ kind: 'resource' as const, resourceId: 'r_DDDDDDDDDDDDDDDDDDDDDD' }],
            constraints: [],
          },
        }],
      },
    }
    expect(operation.inputSchema.safeParse(exactResourceRequest).success).toBe(true)
    expect(operation.inputSchema.safeParse({
      ...exactResourceRequest,
      delegation: {
        ...exactResourceRequest.delegation,
        requests: [{
          ...exactResourceRequest.delegation.requests[0],
          context: {
            ...exactResourceRequest.delegation.requests[0]?.context,
            sourceMaterials: [{
              kind: 'resource',
              resourceId: 'r_DDDDDDDDDDDDDDDDDDDDDD',
              content: 'Caller-authored content must not be accepted for a Resource source.',
            }],
          },
        }],
      },
    }).success).toBe(false)
    expect(operation.inputSchema.safeParse({
      delegation: {
        source: 'chapters',
        chapters: [{
          chapterId: 'chapter-1',
          requestKey: 'chapter-1-video',
          durationIntent: { mode: 'derive' },
        }],
        outputKind: 'video_prompt_set',
        goal: 'Design this Chapter as executable video generations.',
        userRequest: 'Produce the complete long-form story.',
        constraints: ['Preserve continuity with adjacent Chapters.'],
        referencedAssets: [],
      },
    }).success).toBe(true)
    expect(operation.inputSchema.safeParse({
      delegation: {
        source: 'chapters',
        chapters: [{ chapterId: 'chapter-1', requestKey: 'chapter-1-video' }],
        outputKind: 'video_prompt_set',
        goal: 'Design this Chapter as executable video generations.',
        userRequest: 'Produce the complete long-form story.',
        constraints: ['Preserve continuity with adjacent Chapters.'],
        referencedAssets: [],
      },
    }).success).toBe(false)
    expect(operation.inputSchema.safeParse({
      delegation: {
        source: 'requests',
        requests: [{
          requestKey: 'derived-duration-video',
          outputKind: 'video_prompt_set',
          goal: 'Design the complete requested video.',
          durationIntent: { mode: 'derive' },
          context: { userRequest: 'Film this scene.', sourceMaterials: [], constraints: [] },
        }],
      },
    }).success).toBe(true)
    expect(operation.inputSchema.safeParse({
      delegation: {
        source: 'requests',
        requests: [{
          requestKey: 'missing-duration-intent-video',
          outputKind: 'video_prompt_set',
          goal: 'Design the complete requested video.',
          context: { userRequest: 'Film this scene.', sourceMaterials: [], constraints: [] },
        }],
      },
    }).success).toBe(false)
    expect(operation.inputSchema.safeParse({
      delegation: {
        source: 'requests',
        requests: [{
          requestKey: 'legacy-null-branches',
          outputKind: 'music_direction',
          goal: 'Score the supplied result.',
          context: { userRequest: '', sourceMaterials: [], constraints: [] },
        }],
        request: null,
        chapterBatch: null,
      },
    }).success).toBe(false)
  })

  it('keeps every Creative Skill flat, single-document, registry-addressed, and Worker-readable', async () => {
    expect(Object.keys(CREATIVE_SKILL_REGISTRY)).toEqual([...CREATIVE_SKILL_IDS])

    const skillsRoot = path.join(process.cwd(), 'src', 'lib', 'creative-skills', 'skills')
    // The registry is the only Skill identity. A directory that no id declares
    // would be an orphan the loader can never reach.
    expect(fs.readdirSync(skillsRoot).sort()).toEqual([...CREATIVE_SKILL_IDS].sort())

    for (const skillId of CREATIVE_SKILL_IDS) {
      const definition = CREATIVE_SKILL_REGISTRY[skillId]
      const skillDir = path.join(skillsRoot, skillId)
      expect(fs.readdirSync(skillDir).sort(), skillId).toEqual(['SKILL.md'])
      expect(definition.entryUri).toBe(`skill://${skillId}/SKILL.md`)

      const resource = await readCreativeSkillResource({ uri: definition.entryUri })
      expect(resource.skillId).toBe(skillId)
      expect(resource.content.trim().length).toBeGreaterThan(0)
      expect(resource.checksum).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('gives every Creative Worker the complete Skill catalog and only registry-declared tools', () => {
    const catalog = listCreativeWorkerSkillCatalog()
    expect(catalog.map((skill) => skill.id)).toEqual([
      ...CREATIVE_SKILL_IDS,
    ])
    expect(catalog.every((skill) => (
      skill.title.length > 0 && skill.summary.length > 0 && skill.entryUri.startsWith('skill://')
    ))).toBe(true)
    expect(Object.keys(creativeWorkOutputRegistry)).toEqual([...CREATIVE_WORK_OUTPUT_KINDS])
    for (const outputKind of CREATIVE_WORK_OUTPUT_KINDS) {
      const catalogToken = `outputKind=${outputKind}`
      expect(
        catalog.some((skill) => skill.summary.includes(catalogToken)),
        `Skill catalog must route ${outputKind}`,
      ).toBe(true)
    }
    expect(Object.values(creativeWorkOutputRegistry).every((definition) => (
      !('requiredSkillIds' in definition)
    ))).toBe(true)
    expect(Object.fromEntries(Object.entries(creativeWorkOutputRegistry).map(([kind, definition]) => (
      [kind, definition.resourceScope]
    )))).toEqual({
      screenplay: 'project',
      story_canon: 'project',
      chapter_plan: 'episode',
      continuity_analysis: 'episode',
      creative_direction: 'project',
      asset_manifest: 'project',
      video_prompt_set: 'episode',
      music_direction: 'episode',
    })
    expect(Object.fromEntries(Object.entries(creativeWorkOutputRegistry).map(([kind, definition]) => (
      [kind, definition.injectCreativeDirection]
    )))).toEqual({
      screenplay: true,
      story_canon: true,
      chapter_plan: true,
      continuity_analysis: true,
      creative_direction: false,
      asset_manifest: true,
      video_prompt_set: true,
      music_direction: true,
    })
    expect(Object.fromEntries(Object.entries(creativeWorkOutputRegistry).map(([kind, definition]) => (
      [kind, createCreativeWorkerTools({
        workerTools: definition.workerTools,
        submitOutputJson: () => ({ accepted: true, outputKind: kind }),
      }).map((tool) => tool.name)]
    )))).toEqual({
      screenplay: ['read_skill', 'submit_result'],
      story_canon: ['read_skill', 'submit_result'],
      chapter_plan: ['read_skill', 'submit_result'],
      continuity_analysis: ['read_skill', 'submit_result'],
      creative_direction: ['read_skill', 'web_search', 'submit_result'],
      asset_manifest: ['read_skill', 'submit_result'],
      video_prompt_set: ['read_skill', 'submit_result'],
      music_direction: ['read_skill', 'submit_result'],
    })
    for (const outputKind of CREATIVE_WORK_OUTPUT_KINDS) {
      const definition = creativeWorkOutputRegistry[outputKind]
      {
        const systemPrompt = buildCreativeWorkerSystemPrompt({
          enableWebSearch: definition.workerTools.length > 0,
        })
        expect(systemPrompt.includes('web_search')).toBe(outputKind === 'creative_direction')
        expect(systemPrompt).not.toContain('video_prompt_set')
        expect(systemPrompt).not.toContain('productionContext')
        expect(systemPrompt).not.toContain('durationIntent')
      }
    }
    const adoptedDirection = {
      resourceId: 'r_EEEEEEEEEEEEEEEEEEEEEE',
      direction: {
        styleSummary: 'Restrained procedural observation',
        rawUserStyle: '规则怪谈',
        visual: {
          visualStyle: 'Low-saturation institutional video.',
          assetImageStyle: {
            lighting: 'Flat fluorescent reference lighting.',
            texture: 'Compressed institutional video texture.',
          },
        },
        narrative: 'Release rules before revealing their consequences.',
        directing: 'Locked frames are the default.',
        editing: 'Cut only when evidence changes.',
        sound: 'Preserve room tone and use silence for rule violations.',
        assetPolicy: 'Keep signage and recurring props legible and stable.',
      },
    }
    for (const outputKind of CREATIVE_WORK_OUTPUT_KINDS) {
      const projected = projectAdoptedCreativeDirection({
        snapshot: adoptedDirection,
        outputKind,
      })
      if (outputKind === 'creative_direction') {
        expect(projected).toBeNull()
        continue
      }
      expect(projected).toEqual(adoptedDirection)
    }
    expect(projectAdoptedCreativeDirection({
      snapshot: adoptedDirection,
      outputKind: 'creative_direction',
    })).toBeNull()

    const videoOutput = {
      kind: 'video_prompt_set',
      segments: [{
        key: 'clip-1',
        durationSeconds: 10,
        prompt: '10-second 16:9 cinematic video. 0-10s: slow push toward a lantern that ignites as the shrine doors open; preserve the shrine layout and generate synchronized wind, timber creaks, and one ignition pulse.',
        mediaResourceIds: [],
      }],
    }
    expect(creativeWorkOutputRegistry.video_prompt_set.schema.safeParse(videoOutput).success).toBe(true)
    expect(creativeWorkOutputRegistry.video_prompt_set.schema.safeParse({
      ...videoOutput,
      segments: undefined,
      shots: videoOutput.segments,
    }).success).toBe(false)
    expect(creativeWorkOutputRegistry.video_prompt_set.schema.safeParse({
      ...videoOutput,
      globalDirection: { narrativeIntent: 'Legacy parallel planning authority.' },
    }).success).toBe(false)
    expect(creativeWorkOutputRegistry.asset_manifest.schema.safeParse({
      kind: 'asset_manifest',
      overview: 'One reusable character.',
      assets: [{
        kind: 'character',
        canonicalName: 'Traveler',
        aliases: [],
        sourceRefs: [{
          sourceExcerpt: 'The traveler enters.',
          reason: 'Legacy model-authored evidence.',
        }],
        stableDescription: 'A tired traveler.',
        generationPrompt: 'Character reference for the traveler.',
      }],
      assumptions: [],
      warnings: [],
    }).success).toBe(false)
  })

  it('keeps the Creative Task protocol explicit and its repeated result projections consistent', () => {
    expect(CREATIVE_WORK_TASK_PROTOCOL).toBe('creative_work_v10')
    const lifecycleProjection = {
      requestKey: 'analysis-1',
      outputKind: 'continuity_analysis' as const,
      goal: 'Analyze continuity of the supplied result.',
      events: [{
        sequence: 1,
        occurredAt: '2026-07-20T00:00:00.000Z',
        event: {
          kind: 'started' as const,
          outputKind: 'continuity_analysis' as const,
          goal: 'Analyze continuity of the supplied result.',
        },
      }],
    }
    const payload = {
      protocol: CREATIVE_WORK_TASK_PROTOCOL,
      requestKey: 'analysis-1',
      request: {
        outputKind: 'continuity_analysis' as const,
        goal: 'Analyze continuity of the supplied result.',
        context: { userRequest: '', sourceMaterials: [], constraints: [] },
        creativeDirection: null,
        productionContext: { video: null },
      },
      modelKey: 'test:model',
      inputFingerprint: 'fingerprint',
      origin: { runId: 'run-1', toolCallId: 'tool-1' },
      lifecycleProjection,
      ui: { progressGroupId: 'operation:delegate_creative_work:request-1' },
      meta: {
        locale: 'zh',
        flowId: 'creative-work',
        flowStageIndex: 1,
        flowStageTotal: 1,
        trace: { requestId: 'request-1' },
      },
    }
    expect(creativeWorkTaskPayloadSchema.safeParse(payload).success).toBe(true)
    expect(creativeWorkTaskPayloadSchema.safeParse({
      ...payload,
      protocol: undefined,
    }).success).toBe(false)
    expect(creativeWorkTaskPayloadSchema.safeParse({
      ...payload,
      protocol: 'creative_work_v4',
    }).success).toBe(false)
    expect(creativeWorkTaskPayloadSchema.safeParse({
      ...payload,
      request: {
        ...payload.request,
        creativeDirection: {
          resourceId: 'direction-r1',
          direction: {
            narrative: 'A partial projection is no longer a valid task input.',
          },
        },
      },
    }).success).toBe(false)
    expect(creativeWorkTaskPayloadSchema.safeParse({
      ...payload,
      request: {
        ...payload.request,
        outputKind: 'creative_direction',
        creativeDirection: {
          resourceId: 'direction-r1',
          direction: {
            styleSummary: 'Complete direction',
            rawUserStyle: null,
            visual: {
              visualStyle: 'Restrained realism.',
              assetImageStyle: {
                lighting: 'Soft daylight.',
                texture: 'Natural material detail.',
              },
            },
            narrative: 'Reveal information through behavior.',
            directing: 'Use motivated camera behavior.',
            editing: 'Prefer clean causal cuts.',
            sound: 'Preserve environmental continuity.',
            assetPolicy: 'Keep reusable identities stable.',
          },
        },
      },
      lifecycleProjection: {
        ...payload.lifecycleProjection,
        outputKind: 'creative_direction',
      },
    }).success).toBe(false)

    const result = {
      requestKey: 'analysis-1',
      outputKind: 'continuity_analysis' as const,
      summary: 'The result is coherent.',
      continuationProjection: {
        requestKey: 'analysis-1',
        outputKind: 'continuity_analysis' as const,
        summary: 'The result is coherent.',
      },
      lifecycleProjection,
      creativeWorkResult: {
        outputKind: 'continuity_analysis' as const,
        output: {
          kind: 'continuity_analysis' as const,
          summary: 'The result is coherent.',
          canonFacts: [],
          stateTransitions: [],
          unresolved: [],
          assumptions: [],
        },
        skillTrace: [{
          ordinal: 1,
          source: 'tool' as const,
          skillId: 'continuity-memory' as const,
          version: '1',
          uri: 'skill://continuity-memory/SKILL.md',
          checksum: 'checksum',
          contentChars: 100,
        }],
        metrics: {
          readCalls: 1,
          skillContentChars: 100,
          webSearchCalls: 0,
          webSearchSources: 0,
        },
        budgets: {
          maxTurns: 8,
          maxReadCalls: 8,
          maxWebSearchCalls: 4,
          maxInputChars: 1_000_000,
          maxOutputChars: 100_000,
        },
        research: null,
      },
    }
    expect(creativeWorkTaskResultSchema.safeParse(result).success).toBe(true)
    const materializedResources = [{
      resourceId: 'resource-1',
      schemaId: 'project.continuity_analysis',
      mediaType: 'text' as const,
      name: 'Continuity analysis',
    }]
    expect(creativeWorkTaskResultSchema.safeParse({
      ...result,
      resources: materializedResources,
      continuationProjection: {
        ...result.continuationProjection,
        resources: materializedResources,
      },
    }).success).toBe(true)
    expect(creativeWorkTaskResultSchema.safeParse({
      ...result,
      resources: materializedResources,
      continuationProjection: {
        ...result.continuationProjection,
        resources: [{
          ...materializedResources[0],
          resourceId: 'different-revision',
        }],
      },
    }).success).toBe(false)
    expect(creativeWorkTaskResultSchema.safeParse({
      ...result,
      continuationProjection: {
        ...result.continuationProjection,
        summary: 'Contradictory summary.',
      },
    }).success).toBe(false)
    // skillId in a persisted trace is a historical fact, so registry membership
    // is enforced at the read_skill tool boundary, not here; the projection
    // still rejects a structurally empty identity.
    expect(creativeWorkTaskResultSchema.safeParse({
      ...result,
      creativeWorkResult: {
        ...result.creativeWorkResult,
        skillTrace: [{
          ...result.creativeWorkResult.skillTrace[0],
          skillId: '',
        }],
      },
    }).success).toBe(false)
  })

  it('contains no anonymous permissive schemas or nullable enums that reject null', () => {
    const registry = createProjectAgentOperationRegistry()
    const unbounded: string[] = []
    const nullableEnumViolations: string[] = []

    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      for (const [property, schema] of Object.entries(operation.toolInputSchema.properties)) {
        collectUnboundedSchemaNodes(schema, `${operation.id}/${property}`, unbounded)
      }
      collectNullableEnumViolations(operation.toolInputSchema, operation.id, nullableEnumViolations)
    }

    expect(unbounded).toEqual([])
    expect(nullableEnumViolations).toEqual([])
  })
})
