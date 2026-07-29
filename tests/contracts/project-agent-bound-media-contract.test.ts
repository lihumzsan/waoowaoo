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
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { normalizeProjectAgentToolInput } from '@/lib/operations/tool-input-schema'
import {
  createProjectAgentToolCatalog,
  createProjectAgentToolDiscoveryState,
} from '@/lib/project-agent/tool-discovery'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'

function createState() {
  const registry = createProjectAgentOperationRegistry()
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

describe('project agent bound media contract conformance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelKeys.image = 'fal::gpt-image-2'
    modelKeys.video = 'ark::doubao-seedance-2-0-260128'
    modelKeys.music = 'mureka::mureka-9'
  })

  it('publishes selected capability values without exposing model or provider identity', async () => {
    const state = createState()
    const loaded = await state.load(['create_image', 'create_audio', 'create_video'])
    const byId = new Map(loaded.operations.map((operation) => [operation.operationId, operation]))
    const image = byId.get('create_image')
    const audio = byId.get('create_audio')
    const video = byId.get('create_video')
    if (!image || !audio || !video) throw new Error('BOUND_MEDIA_CONTRACTS_REQUIRED')

    for (const operation of [image, audio, video]) {
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
    for (const value of videoOptions.duration ?? []) {
      expect(JSON.stringify(video.parameters)).toContain(JSON.stringify(value))
    }
    expect(JSON.stringify(audio.parameters)).toContain(
      JSON.stringify(musicCapabilities?.music?.durationSecondsRange?.min),
    )
    expect(JSON.stringify(audio.parameters)).toContain(
      JSON.stringify(musicCapabilities?.music?.durationSecondsRange?.max),
    )
  })

  it('makes video reference combinations and selected duration values structural', async () => {
    const state = createState()
    const loaded = await state.load(['create_video'])
    const contract = loaded.operations[0]
    if (!contract) throw new Error('BOUND_VIDEO_CONTRACT_REQUIRED')
    const durations = getCapabilityOptionFields(
      'video',
      resolveBuiltinCapabilitiesByModelKey('video', modelKeys.video),
    ).duration ?? []
    const durationSeconds = durations.find((value): value is number => typeof value === 'number')
    if (durationSeconds === undefined) throw new Error('BOUND_VIDEO_DURATION_REQUIRED')
    const validate = new Ajv({ allErrors: true, jsonPointers: true }).compile(contract.parameters)
    const common = {
      kind: 'new',
      name: null,
      prompt: 'Animate the exact references.',
      count: null,
      contextReferences: null,
      schemaId: null,
      durationSeconds,
      aspectRatio: null,
      resolution: null,
      generateAudio: null,
    }
    const legal = {
      request: {
        ...common,
        imageReferences: [{ resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA', role: 'reference' }],
        audioReferences: [{ resourceId: 'r_BBBBBBBBBBBBBBBBBBBBBB', role: 'reference' }],
      },
    }
    expect(validate(legal), JSON.stringify(validate.errors)).toBe(true)
    const operation = createProjectAgentOperationRegistry().create_video
    const normalized = normalizeProjectAgentToolInput({
      input: legal,
      inputSchema: operation.inputSchema,
      toolInputSchema: contract.parameters,
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
        imageReferences: null,
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
        imageReferences: null,
      },
    })).toBe(false)
  })

  it('fails closed instead of publishing a broad schema for an unregistered model capability', async () => {
    modelKeys.image = 'unknown-provider::unknown-image-model'
    const state = createState()

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
