import Ajv from 'ajv'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const modelKeys = vi.hoisted(() => ({
  image: 'fal::gpt-image-2',
  video: 'ark::doubao-seedance-2-0-260128',
  music: 'mureka::mureka-9',
}))

vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: null,
    characterModel: null,
    locationModel: null,
    editModel: modelKeys.image,
    videoModel: modelKeys.video,
    musicModel: modelKeys.music,
    videoRatio: '16:9',
    capabilityDefaults: {},
    capabilityOverrides: {},
  })),
}))

vi.mock('@/lib/model-access/system-model-resolver', () => ({
  resolveSystemModelKey: vi.fn(async (input: { purpose: string }) => (
    input.purpose === 'video'
      ? modelKeys.video
      : input.purpose === 'music'
        ? modelKeys.music
        : modelKeys.image
  )),
}))

import {
  getCapabilityOptionFields,
  resolveBuiltinCapabilitiesByModelKey,
} from '@/lib/ai-registry/capabilities-catalog'
import { VOICE_DESIGN_LANGUAGE_OPTIONS } from '@/lib/ai-registry/voice-design-contract'
import { ApiError } from '@/lib/api-errors'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { normalizeProjectAgentToolInput } from '@/lib/operations/tool-input-schema'
import type { ProjectAgentToolInputSchema, RuntimeSchema } from '@/lib/operations/types'
import {
  createProjectAgentToolCatalog,
  createProjectAgentToolDiscoveryState,
} from '@/lib/project-agent/tool-discovery'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'

function createState(registry: ReturnType<typeof createProjectAgentOperationRegistry>) {
  const toolset = resolveProjectAgentToolset({ registry })
  return createProjectAgentToolDiscoveryState({
    registry,
    catalog: createProjectAgentToolCatalog({ registry, toolset }),
    bindingContext: {
      userId: 'bound-contract-user',
      projectId: 'bound-contract-project',
      context: {
        runId: 'bound-contract-run',
        executionSegmentId: 'bound-contract-segment',
        locale: 'en',
      },
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function schemaAllowsNull(schema: unknown): boolean {
  if (schema === null) return true
  if (!isRecord(schema)) return false
  if (schema.type === 'null') return true
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true
  if (Array.isArray(schema.anyOf) && schema.anyOf.some(schemaAllowsNull)) return true
  return Array.isArray(schema.oneOf) && schema.oneOf.some(schemaAllowsNull)
}

function collectSchemaFacts(schema: unknown): {
  nullablePropertyNames: Set<string>
  propertyNames: Set<string>
} {
  const nullablePropertyNames = new Set<string>()
  const propertyNames = new Set<string>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!isRecord(node)) return
    if (isRecord(node.properties)) {
      for (const [name, property] of Object.entries(node.properties)) {
        propertyNames.add(name)
        if (schemaAllowsNull(property)) nullablePropertyNames.add(name)
      }
    }
    for (const child of Object.values(node)) walk(child)
  }
  walk(schema)
  return { nullablePropertyNames, propertyNames }
}

interface MediaToolPairing {
  operationId: string
  parameters: ProjectAgentToolInputSchema
  inputSchema: RuntimeSchema<unknown>
}

async function loadBillableMediaPairings(): Promise<{
  registry: ReturnType<typeof createProjectAgentOperationRegistry>
  pairings: MediaToolPairing[]
}> {
  const registry = createProjectAgentOperationRegistry()
  const state = createState(registry)
  const billable = Object.values(registry)
    .filter((operation) => operation.confirmation.kind === 'billable_media' && operation.channels.tool)
  const pairings: MediaToolPairing[] = []
  for (const operation of billable) {
    const loaded = await state.load([operation.id])
    const definition = loaded.operations[0]
    if (!definition) throw new Error(`MEDIA_TOOL_DEFINITION_REQUIRED:${operation.id}`)
    const resolved = definition.kind === 'bound'
      ? await state.resolveContract(operation.id, definition.contractId)
      : null
    pairings.push({
      operationId: operation.id,
      parameters: resolved?.toolInputSchema ?? definition.parameters,
      inputSchema: resolved?.inputSchema ?? operation.inputSchema,
    })
  }
  return { registry, pairings }
}

function buildMinimalStrictInput(operationId: string): unknown {
  if (operationId === 'create_image') {
    const optionFields = getCapabilityOptionFields(
      'image',
      resolveBuiltinCapabilitiesByModelKey('image', modelKeys.image),
    )
    return {
      request: {
        kind: 'new',
        name: 'Minimal image',
        prompt: 'One minimal image.',
        count: 1,
        contextReferences: [],
        imageReferences: [],
        schemaId: 'generic.image',
        ...(optionFields.resolution ? { resolution: 'auto' } : {}),
        ...(optionFields.quality ? { quality: 'auto' } : {}),
      },
    }
  }
  if (operationId === 'create_audio') {
    const capabilities = resolveBuiltinCapabilitiesByModelKey('music', modelKeys.music)
    const optionFields = getCapabilityOptionFields('music', capabilities)
    const durationSeconds = typeof optionFields.durationSeconds?.[0] === 'number'
      ? optionFields.durationSeconds[0]
      : Math.ceil(capabilities?.music?.durationSecondsRange?.min ?? 1)
    return {
      request: {
        kind: 'new',
        name: 'Minimal track',
        prompt: 'One minimal track.',
        contextReferences: [],
        durationSeconds,
        genre: '',
        mood: '',
        ...(optionFields.vocalMode ? { vocalMode: 'auto' } : {}),
        ...(optionFields.outputFormat ? { outputFormat: 'auto' } : {}),
        ...(optionFields.bpm ? { bpm: 'auto' } : {}),
        ...((capabilities?.music?.maxReferenceVideos ?? 0) > 0 ? { videoReferences: [] } : {}),
      },
    }
  }
  if (operationId === 'create_video') {
    const capabilities = resolveBuiltinCapabilitiesByModelKey('video', modelKeys.video)
    const optionFields = getCapabilityOptionFields('video', capabilities)
    const durationSeconds = optionFields.duration?.find(
      (value): value is number => typeof value === 'number' && value <= 15,
    )
    if (durationSeconds === undefined) throw new Error('BOUND_VIDEO_DURATION_REQUIRED')
    return {
      request: {
        kind: 'new',
        name: 'Minimal video',
        prompt: 'One minimal video segment.',
        count: 1,
        contextReferences: [],
        schemaId: 'generic.video',
        durationSeconds,
        ...(optionFields.resolution ? { resolution: 'auto' } : {}),
        ...(optionFields.generateAudio ? { generateAudio: 'auto' } : {}),
        imageReferences: capabilities?.video?.supportsTextToVideo
          ? []
          : [{ resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA', role: 'reference' }],
        ...((capabilities?.video?.maxReferenceAudios ?? 0) > 0 ? { audioReferences: [] } : {}),
      },
    }
  }
  if (operationId === 'generate_voice') {
    return {
      request: {
        kind: 'single',
        description: 'Warm mid-range narrator voice.',
        previewText: 'Hello, this is a short preview.',
        language: VOICE_DESIGN_LANGUAGE_OPTIONS[0],
        resource: { name: 'Narrator' },
        target: { kind: 'standalone' },
      },
    }
  }
  throw new Error(`BILLABLE_MEDIA_MINIMAL_INPUT_MISSING:${operationId}`)
}

describe('project agent bound media contract conformance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelKeys.image = 'fal::gpt-image-2'
    modelKeys.video = 'ark::doubao-seedance-2-0-260128'
    modelKeys.music = 'mureka::mureka-9'
  })

  it('publishes selected capability values without exposing model or provider identity', async () => {
    const registry = createProjectAgentOperationRegistry()
    const state = createState(registry)
    const loaded = await state.load(['create_image', 'create_audio', 'create_video'])
    const byId = new Map(loaded.operations.map((operation) => [operation.operationId, operation]))
    const image = byId.get('create_image')
    const audio = byId.get('create_audio')
    const video = byId.get('create_video')
    if (!image || !audio || !video) throw new Error('BOUND_MEDIA_CONTRACTS_REQUIRED')

    for (const operation of [image, audio, video]) {
      expect(operation.kind).toBe('bound')
      if (operation.kind !== 'bound') throw new Error('BOUND_MEDIA_CONTRACT_REQUIRED')
      const serialized = JSON.stringify(operation.parameters)
      expect(serialized).not.toContain('modelKey')
      expect(serialized).not.toContain(modelKeys.image)
      expect(serialized).not.toContain(modelKeys.music)
      expect(serialized).not.toContain(modelKeys.video)
      expect(operation.contractId).toMatch(/^[0-9a-f-]{36}$/)
      expect(operation.revision).toMatch(/^[a-f0-9]{64}$/)
    }

    const imageOptions = getCapabilityOptionFields(
      'image',
      resolveBuiltinCapabilitiesByModelKey('image', modelKeys.image),
    )
    const videoOptions = getCapabilityOptionFields(
      'video',
      resolveBuiltinCapabilitiesByModelKey('video', modelKeys.video),
    )
    const musicCapabilities = resolveBuiltinCapabilitiesByModelKey('music', modelKeys.music)
    for (const value of imageOptions.resolution ?? []) {
      expect(JSON.stringify(image.parameters)).toContain(JSON.stringify(value))
    }
    for (const value of (videoOptions.duration ?? []).filter((duration) => (
      typeof duration === 'number' && duration <= 15
    ))) {
      expect(JSON.stringify(video.parameters)).toContain(JSON.stringify(value))
    }
    expect(JSON.stringify(audio.parameters)).toContain(
      JSON.stringify(musicCapabilities?.music?.durationSecondsRange?.min),
    )
    expect(JSON.stringify(audio.parameters)).toContain(
      JSON.stringify(musicCapabilities?.music?.durationSecondsRange?.max),
    )
  })

  it('keeps every billable media strict schema free of aspectRatio, size, and translation-requiring nullables', async () => {
    const { pairings } = await loadBillableMediaPairings()
    expect(pairings.map((pairing) => pairing.operationId).sort()).toEqual([
      'create_audio',
      'create_image',
      'create_video',
      'generate_voice',
    ])
    // expectedVersion is the one real nullable fact: the canonical Zod schema
    // accepts null there, so no strict-to-canonical translation is required.
    const allowedNullableNames = new Set(['expectedVersion'])
    for (const pairing of pairings) {
      const facts = collectSchemaFacts(pairing.parameters)
      expect(facts.propertyNames.has('aspectRatio'), pairing.operationId).toBe(false)
      expect(facts.propertyNames.has('size'), pairing.operationId).toBe(false)
      const forbiddenNullable = [...facts.nullablePropertyNames]
        .filter((name) => !allowedNullableNames.has(name))
      expect(forbiddenNullable, pairing.operationId).toEqual([])
    }
  })

  it('accepts the minimal strict output of every billable media tool through the canonical parser untouched', async () => {
    const { registry, pairings } = await loadBillableMediaPairings()
    for (const pairing of pairings) {
      const operation = registry[pairing.operationId]
      if (!operation) throw new Error(`OPERATION_REQUIRED:${pairing.operationId}`)
      const input = buildMinimalStrictInput(pairing.operationId)
      const validate = new Ajv({ allErrors: true, jsonPointers: true }).compile(pairing.parameters)
      expect(validate(input), `${pairing.operationId}: ${JSON.stringify(validate.errors)}`).toBe(true)
      const boundParse = pairing.inputSchema.safeParse(input)
      expect(boundParse.success, pairing.operationId).toBe(true)
      const canonicalParse = operation.inputSchema.safeParse(input)
      expect(canonicalParse.success, `${pairing.operationId}: ${JSON.stringify(
        canonicalParse.success ? null : canonicalParse.error.issues,
      )}`).toBe(true)
      const normalized = normalizeProjectAgentToolInput({
        operationId: pairing.operationId,
        input,
        inputSchema: pairing.inputSchema,
        toolInputSchema: pairing.parameters,
      })
      expect(normalized, pairing.operationId).toBe(input)
    }
  })

  it('makes video reference combinations and selected duration values structural', async () => {
    const registry = createProjectAgentOperationRegistry()
    const state = createState(registry)
    const loaded = await state.load(['create_video'])
    const contract = loaded.operations[0]
    if (!contract || contract.kind !== 'bound') throw new Error('BOUND_VIDEO_CONTRACT_REQUIRED')
    const resolved = await state.resolveContract('create_video', contract.contractId)
    const minimal = buildMinimalStrictInput('create_video') as {
      request: Record<string, unknown>
    }
    const common = { ...minimal.request }
    delete common.imageReferences
    delete common.audioReferences
    const validate = new Ajv({ allErrors: true, jsonPointers: true }).compile(contract.parameters)
    const legal = {
      request: {
        ...common,
        imageReferences: [{ resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA', role: 'reference' }],
        audioReferences: [{ resourceId: 'r_BBBBBBBBBBBBBBBBBBBBBB', role: 'reference' }],
      },
    }
    expect(validate(legal), JSON.stringify(validate.errors)).toBe(true)
    const operation = registry.create_video
    // Production pairing: the bound contract runtime schema together with the
    // bound strict parameters, then the canonical registry parser.
    const normalized = normalizeProjectAgentToolInput({
      operationId: 'create_video',
      input: legal,
      inputSchema: resolved.inputSchema,
      toolInputSchema: resolved.toolInputSchema,
    })
    expect(operation.inputSchema.safeParse(normalized).success).toBe(true)
    expect(validate({
      request: {
        kind: 'prompt_set',
        resourceId: 'r_CCCCCCCCCCCCCCCCCCCCCC',
      },
    }), JSON.stringify(validate.errors)).toBe(true)
    expect(validate({
      request: {
        kind: 'prompt_set',
        resourceId: 'r_CCCCCCCCCCCCCCCCCCCCCC',
        prompt: 'Do not duplicate the Prompt Set payload.',
      },
    })).toBe(false)
    expect(validate({
      request: {
        ...common,
        imageReferences: [],
        audioReferences: [{ resourceId: 'r_BBBBBBBBBBBBBBBBBBBBBB', role: 'reference' }],
      },
    })).toBe(false)
    expect(validate({
      request: {
        ...common,
        imageReferences: [{ resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA', role: 'first_frame' }],
        audioReferences: [{ resourceId: 'r_BBBBBBBBBBBBBBBBBBBBBB', role: 'reference' }],
      },
    })).toBe(false)
    expect(validate({
      request: {
        ...common,
        durationSeconds: 999,
        imageReferences: [{ resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA', role: 'reference' }],
        audioReferences: [],
      },
    })).toBe(false)
  })

  it('normalizes legacy nullable strict input for optional-field tools and fails loudly when it cannot', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.create_text
    if (!operation) throw new Error('CREATE_TEXT_OPERATION_REQUIRED')
    const normalized = normalizeProjectAgentToolInput({
      operationId: operation.id,
      input: {
        name: null,
        prompt: 'Persist this text.',
        contextReferences: null,
        content: { kind: 'single', text: 'hello world' },
      },
      inputSchema: operation.inputSchema,
      toolInputSchema: operation.toolInputSchema,
    })
    expect(operation.inputSchema.safeParse(normalized).success).toBe(true)

    let thrown: unknown = null
    try {
      normalizeProjectAgentToolInput({
        operationId: operation.id,
        input: {
          name: null,
          prompt: null,
          contextReferences: null,
          content: { kind: 'single', text: null },
        },
        inputSchema: operation.inputSchema,
        toolInputSchema: operation.toolInputSchema,
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ApiError)
    const details = (thrown as ApiError).details ?? {}
    expect(details.code).toBe('OPERATION_INPUT_INVALID')
    expect(Array.isArray(details.corrections)).toBe(true)
    expect((details.corrections as unknown[]).length).toBeGreaterThan(0)
  })

  it('fails closed instead of publishing a broad schema for an unregistered model capability', async () => {
    modelKeys.image = 'unknown-provider::unknown-image-model'
    const registry = createProjectAgentOperationRegistry()
    const state = createState(registry)

    await expect(state.load(['create_image'])).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'CAPABILITY_MODEL_UNSUPPORTED',
        field: 'modelKey',
        modelKey: modelKeys.image,
      }),
    })
  })
})
