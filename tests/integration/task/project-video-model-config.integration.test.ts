import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  COMFYUI_PLATFORM_DEFAULT_SOUND_MODEL_KEY,
  COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
} from '@/lib/ai-providers/comfyui/models'
import {
  CODEX_PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY,
  CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
} from '@/lib/ai-providers/codex/models'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import { planOperation } from '@/lib/operations/planning'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { getPlatformDefaultModels, getPlatformModels } from '@/lib/platform-models/catalog'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  materializeWorkspaceResourceInTransaction,
  reserveWorkspaceResourceInTransaction,
} from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

const CUSTOM_VIDEO_MODEL_KEY = 'fal::custom-video'
const ORIGINAL_DEPLOYMENT_EDITION = process.env.DEPLOYMENT_EDITION
const ORIGINAL_PROVIDER_CREDENTIAL_MODE = process.env.PROVIDER_CREDENTIAL_MODE
const ORIGINAL_PLATFORM_DEFAULT_VIDEO_MODEL = process.env.PLATFORM_DEFAULT_VIDEO_MODEL
const ORIGINAL_PLATFORM_VIDEO_RESOLUTION = process.env.PLATFORM_VIDEO_RESOLUTION

function restoreEnvironment(
  name:
    | 'DEPLOYMENT_EDITION'
    | 'PROVIDER_CREDENTIAL_MODE'
    | 'PLATFORM_DEFAULT_VIDEO_MODEL'
    | 'PLATFORM_VIDEO_RESOLUTION',
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

function operationContext(userId: string, projectId: string): ProjectAgentOperationContext {
  return {
    request: {} as never,
    requestId: `project-video-model-config:${userId}`,
    userId,
    projectId,
    context: {},
    source: 'project-video-model-config-integration',
    writer: null,
    toolCallId: null,
    activityId: null,
  }
}

async function invokeConfig(params: {
  userId: string
  projectId: string
  input: unknown
}) {
  return await invokeProjectAgentOperation({
    registry: createProjectAgentOperationRegistryForApi(),
    channel: 'api',
    operationId: 'update_project_config',
    context: operationContext(params.userId, params.projectId),
    input: params.input,
  })
}

async function configureCustomVideoModel(userId: string) {
  await prisma.userPreference.create({
    data: {
      userId,
      videoModel: CUSTOM_VIDEO_MODEL_KEY,
      customModels: JSON.stringify([{
        modelId: 'custom-video',
        modelKey: CUSTOM_VIDEO_MODEL_KEY,
        name: 'Custom Video',
        type: 'video',
        provider: 'fal',
      }]),
      customProviders: JSON.stringify([{
        id: 'fal',
        name: 'FAL',
        apiKey: 'stored-provider-key',
      }]),
    },
  })
}

async function seedReadyImage(input: {
  userId: string
  projectId: string
}): Promise<{ resourceId: string; contentVersion: number }> {
  const resourceId = buildWorkspaceResourceId({
    operationId: 'project_video_model_config_source',
    requestId: input.projectId,
    memberIndex: 0,
  })
  const media = await ensureMediaObjectFromStorageKey(
    `tests/project-video-model-config/${input.projectId}.png`,
    {
      mimeType: 'image/png',
      sizeBytes: 1,
      width: 720,
      height: 1280,
    },
  )
  return await prisma.$transaction(async (tx) => {
    await reserveWorkspaceResourceInTransaction(tx, {
      resourceId,
      userId: input.userId,
      projectId: input.projectId,
      outputPath: `${resourceId}.png`,
      mediaType: 'image',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      sourceType: 'integration_test_fixture',
      sourceId: resourceId,
    })
    return await materializeWorkspaceResourceInTransaction(tx, {
      resourceId,
      userId: input.userId,
      projectId: input.projectId,
      mediaType: 'image',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      content: { kind: 'media', mediaId: media.id },
      inputs: [],
      provenance: {
        operationId: null,
        inputHash: null,
        taskId: null,
        operationExecutionId: null,
        toolCallId: null,
        prompt: null,
        modelKey: null,
        generationOptions: null,
      },
    })
  })
}

function videoOptions(value: unknown): Array<{ value: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const video = Reflect.get(value, 'video')
  if (!Array.isArray(video)) return []
  return video.filter((option): option is { value: string } => (
    !!option
    && typeof option === 'object'
    && !Array.isArray(option)
    && typeof Reflect.get(option, 'value') === 'string'
  ))
}

describe('project local video model configuration', () => {
  beforeEach(async () => {
    process.env.DEPLOYMENT_EDITION = 'self-hosted'
    process.env.PROVIDER_CREDENTIAL_MODE = 'user-key'
    delete process.env.PLATFORM_DEFAULT_VIDEO_MODEL
    delete process.env.PLATFORM_VIDEO_RESOLUTION
    await resetBillingState()
  })

  afterAll(() => {
    restoreEnvironment('DEPLOYMENT_EDITION', ORIGINAL_DEPLOYMENT_EDITION)
    restoreEnvironment('PROVIDER_CREDENTIAL_MODE', ORIGINAL_PROVIDER_CREDENTIAL_MODE)
    restoreEnvironment('PLATFORM_DEFAULT_VIDEO_MODEL', ORIGINAL_PLATFORM_DEFAULT_VIDEO_MODEL)
    restoreEnvironment('PLATFORM_VIDEO_RESOLUTION', ORIGINAL_PLATFORM_VIDEO_RESOLUTION)
  })

  it('publishes only catalog-backed local ComfyUI video models', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await configureCustomVideoModel(user.id)

    const result = await invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'list_user_models',
      context: operationContext(user.id, project.id),
      input: {},
    })
    const expected = getPlatformModels()
      .filter((model) => model.type === 'video' && model.provider === 'comfyui')
      .map((model) => model.modelKey)

    expect(videoOptions(result.data).map((option) => option.value)).toEqual(expected)
    expect(expected).toContain(COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY)
    expect(expected).not.toContain(CUSTOM_VIDEO_MODEL_KEY)
  })

  it('rejects non-local video identities before every canonical write and persists H3', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await configureCustomVideoModel(user.id)

    for (const videoModel of ['codex::gpt-image-2', CUSTOM_VIDEO_MODEL_KEY]) {
      await expect(invokeConfig({
        userId: user.id,
        projectId: project.id,
        input: { videoModel },
      })).rejects.toMatchObject({
        details: expect.objectContaining({
          code: 'PROJECT_VIDEO_MODEL_NOT_AVAILABLE',
          field: 'videoModel',
        }),
      })
      await expect(prisma.project.findUniqueOrThrow({
        where: { id: project.id },
        select: { videoModel: true },
      })).resolves.toEqual({ videoModel: null })
    }

    await invokeConfig({
      userId: user.id,
      projectId: project.id,
      input: { videoModel: COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY },
    })
    await expect(prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { videoModel: true },
    })).resolves.toEqual({ videoModel: COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY })

    await invokeConfig({
      userId: user.id,
      projectId: project.id,
      input: { videoModel: null },
    })
    await expect(prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { videoModel: true },
    })).resolves.toEqual({ videoModel: null })
  })

  it('resolves H3 built-in capability defaults for local generation without persisted selections', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await prisma.project.update({
      where: { id: project.id },
      data: { videoModel: COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY },
    })

    await expect(resolveProjectModelCapabilityGenerationOptions({
      projectId: project.id,
      userId: user.id,
      modelType: 'video',
      modelKey: COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
      runtimeSelections: {
        duration: 5,
        generationMode: 'normal',
      },
    })).resolves.toEqual({
      resolution: '720p',
      generateAudio: true,
      duration: 5,
      generationMode: 'normal',
    })
  })

  it('merges persisted H3 selections over built-in defaults by field', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await prisma.userPreference.create({
      data: {
        userId: user.id,
        videoModel: COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
        capabilityDefaults: JSON.stringify({
          [COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY]: {
            resolution: '480p',
          },
        }),
      },
    })

    await expect(resolveProjectModelCapabilityGenerationOptions({
      projectId: project.id,
      userId: user.id,
      modelType: 'video',
      modelKey: COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
      runtimeSelections: {
        duration: 5,
        generationMode: 'normal',
      },
    })).resolves.toEqual({
      resolution: '480p',
      generateAudio: true,
      duration: 5,
      generationMode: 'normal',
    })
  })

  it('preserves capability failures at the create_video planning boundary', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const source = await seedReadyImage({ userId: user.id, projectId: project.id })
    await prisma.project.update({
      where: { id: project.id },
      data: {
        videoModel: COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
        videoRatio: '9:16',
        capabilityOverrides: JSON.stringify({
          [COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY]: {
            resolution: 'invalid-resolution',
          },
        }),
      },
    })
    const operation = createProjectAgentOperationRegistryForApi().create_video
    const parsedInput = operation.inputSchema.safeParse({
      request: {
        kind: 'new',
        items: [{
          itemId: 'video-1',
          name: 'H3 capability failure',
          mediaType: 'video',
          schemaId: WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT,
          prompt: 'A calm camera move through a mountain valley.',
          references: [{
            resourceId: source.resourceId,
            contentVersion: source.contentVersion,
            role: 'first_frame',
            channel: 'image',
          }],
          durationSeconds: 5,
          count: 1,
        }],
      },
    })
    expect(parsedInput.success).toBe(true)
    if (!parsedInput.success) throw new Error('create_video integration input must be valid')

    await expect(planOperation({
      operation,
      ctx: operationContext(user.id, project.id),
      input: parsedInput.data,
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'MEDIA_GENERATION_CAPABILITY_INVALID',
        field: 'video',
        reason: expect.stringMatching(/^CAPABILITY_VALUE_NOT_ALLOWED:/),
      }),
    })
  })

  it('rejects an unavailable inherited video preference before creating a project', async () => {
    const user = await createTestUser()
    const anchorProject = await createTestProject(user.id)
    await configureCustomVideoModel(user.id)

    await expect(invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'create_project',
      context: operationContext(user.id, anchorProject.id),
      input: { name: 'Local video project' },
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'PROJECT_VIDEO_MODEL_NOT_AVAILABLE',
        field: 'videoModel',
      }),
    })
    await expect(prisma.project.count({ where: { userId: user.id } })).resolves.toBe(1)
  })

  it('persists the complete local production preset for a new project without user defaults', async () => {
    const user = await createTestUser()
    const invocation = await invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'create_project',
      context: operationContext(user.id, 'system'),
      input: { name: 'Default production project' },
    })
    const result = invocation.data as { project: { id: string } }

    await expect(prisma.project.findUniqueOrThrow({
      where: { id: result.project.id },
      select: {
        analysisModel: true,
        characterModel: true,
        locationModel: true,
        editModel: true,
        videoModel: true,
        musicModel: true,
        soundModel: true,
        videoRatio: true,
        videoVocalPerformanceMode: true,
        capabilityOverrides: true,
      },
    })).resolves.toEqual({
      analysisModel: CODEX_PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY,
      characterModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      locationModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      editModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      videoModel: COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
      musicModel: null,
      soundModel: COMFYUI_PLATFORM_DEFAULT_SOUND_MODEL_KEY,
      videoRatio: '9:16',
      videoVocalPerformanceMode: 'native_dialogue',
      capabilityOverrides: JSON.stringify({
        [CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY]: {
          resolution: '2K',
          quality: 'medium',
        },
      }),
    })
  })

  it('preserves persisted user ratio and Codex Image defaults when creating from an implicit preset', async () => {
    const user = await createTestUser()
    await prisma.userPreference.create({
      data: {
        userId: user.id,
        videoRatio: '16:9',
        capabilityDefaults: JSON.stringify({
          [CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY]: {
            resolution: '4K',
            quality: 'high',
          },
        }),
      },
    })

    const invocation = await invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'create_project',
      context: operationContext(user.id, 'system'),
      input: { name: 'Preference-aware production project' },
    })
    const result = invocation.data as { project: { id: string } }

    await expect(prisma.project.findUniqueOrThrow({
      where: { id: result.project.id },
      select: { videoRatio: true, capabilityOverrides: true },
    })).resolves.toEqual({
      videoRatio: '16:9',
      capabilityOverrides: JSON.stringify({
        [CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY]: {
          resolution: '4K',
          quality: 'high',
        },
      }),
    })
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['an invalid Codex Image value', JSON.stringify({
      [CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY]: { resolution: '8K', quality: 'medium' },
    })],
  ])('rejects %s in stored capability defaults before creating a project', async (_caseName, capabilityDefaults) => {
    const user = await createTestUser()
    await prisma.userPreference.create({ data: { userId: user.id, capabilityDefaults } })

    await expect(invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'create_project',
      context: operationContext(user.id, 'system'),
      input: { name: 'Rejected capability project' },
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: expect.stringMatching(/^CAPABILITY_/),
        field: expect.any(String),
      }),
    })
    await expect(prisma.project.count({ where: { userId: user.id } })).resolves.toBe(0)
  })

  it('persists the portrait default without changing Cloud platform model defaults', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    const user = await createTestUser()
    const invocation = await invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'create_project',
      context: operationContext(user.id, 'system'),
      input: { name: 'Cloud portrait project' },
    })
    const result = invocation.data as { project: { id: string } }
    const platformDefaults = getPlatformDefaultModels()

    await expect(prisma.project.findUniqueOrThrow({
      where: { id: result.project.id },
      select: {
        videoRatio: true,
        analysisModel: true,
        characterModel: true,
        locationModel: true,
        editModel: true,
        videoModel: true,
        musicModel: true,
        soundModel: true,
      },
    })).resolves.toEqual({
      videoRatio: '9:16',
      analysisModel: platformDefaults.analysisModel,
      characterModel: platformDefaults.characterModel,
      locationModel: platformDefaults.locationModel,
      editModel: platformDefaults.editModel,
      videoModel: platformDefaults.videoModel,
      musicModel: platformDefaults.musicModel,
      soundModel: platformDefaults.soundModel,
    })
  })

  it('preserves Cloud user-key model setup semantics without local presets', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'user-key'
    const user = await createTestUser()
    const invocation = await invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'create_project',
      context: operationContext(user.id, 'system'),
      input: { name: 'Cloud user-key project' },
    })
    const result = invocation.data as { project: { id: string } }

    await expect(prisma.project.findUniqueOrThrow({
      where: { id: result.project.id },
      select: {
        analysisModel: true,
        characterModel: true,
        locationModel: true,
        editModel: true,
        videoModel: true,
        musicModel: true,
        soundModel: true,
        videoRatio: true,
        capabilityOverrides: true,
      },
    })).resolves.toEqual({
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      editModel: null,
      videoModel: null,
      musicModel: null,
      soundModel: null,
      videoRatio: '9:16',
      capabilityOverrides: null,
    })
  })

  it('rejects corrupt stored capability defaults before Cloud user-key project creation', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'user-key'
    const user = await createTestUser()
    await prisma.userPreference.create({ data: { userId: user.id, capabilityDefaults: '{not-json' } })

    await expect(invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'create_project',
      context: operationContext(user.id, 'system'),
      input: { name: 'Rejected Cloud capability project' },
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'CAPABILITY_SELECTION_INVALID',
        field: 'capabilityDefaults',
      }),
    })
    await expect(prisma.project.count({ where: { userId: user.id } })).resolves.toBe(0)
  })

  it('rejects an unavailable self-hosted video preference before persistence', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)

    await expect(invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'update_user_preference',
      context: operationContext(user.id, project.id),
      input: { videoModel: CUSTOM_VIDEO_MODEL_KEY },
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'PROJECT_VIDEO_MODEL_NOT_AVAILABLE',
        field: 'videoModel',
      }),
    })
    await expect(prisma.userPreference.findUnique({
      where: { userId: user.id },
      select: { videoModel: true },
    })).resolves.toBeNull()
  })

  it('rejects an unavailable video default from the full API-config writer', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)

    await expect(invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'put_user_api_config',
      context: operationContext(user.id, project.id),
      input: {
        providers: [{
          id: 'fal',
          name: 'FAL',
          apiKey: 'stored-provider-key',
        }],
        models: [{
          modelId: 'custom-video',
          name: 'Custom Video',
          type: 'video',
          provider: 'fal',
        }],
        defaultModels: { videoModel: CUSTOM_VIDEO_MODEL_KEY },
      },
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'PROJECT_VIDEO_MODEL_NOT_AVAILABLE',
        field: 'videoModel',
      }),
    })
    await expect(prisma.userPreference.findUnique({
      where: { userId: user.id },
      select: { videoModel: true },
    })).resolves.toBeNull()
  })

  it('returns the persisted effective defaults from the full API-config writer', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)

    const result = await invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'put_user_api_config',
      context: operationContext(user.id, project.id),
      input: {
        defaultModels: {
          characterModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
        },
        capabilityDefaults: [{
          modelKey: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
          field: 'quality',
          value: 'high',
        }],
      },
    })

    expect(result.data).toMatchObject({
      defaultModels: {
        characterModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      },
      capabilityDefaults: {
        [CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY]: {
          quality: 'high',
        },
      },
      effectiveDefaults: {
        defaultModels: {
          characterModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
        },
        capabilityDefaults: {
          [CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY]: {
            resolution: '2K',
            quality: 'high',
          },
        },
        sources: {
          characterModel: 'user',
        },
      },
    })
    await expect(prisma.userPreference.findUniqueOrThrow({
      where: { userId: user.id },
      select: {
        characterModel: true,
        capabilityDefaults: true,
      },
    })).resolves.toEqual({
      characterModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      capabilityDefaults: JSON.stringify({
        [CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY]: {
          quality: 'high',
        },
      }),
    })
  })

  it('preserves Cloud user-key custom-video selection behavior', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'user-key'
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await configureCustomVideoModel(user.id)

    const result = await invokeProjectAgentOperation({
      registry: createProjectAgentOperationRegistryForApi(),
      channel: 'api',
      operationId: 'list_user_models',
      context: operationContext(user.id, project.id),
      input: {},
    })

    expect(videoOptions(result.data).map((option) => option.value)).toContain(CUSTOM_VIDEO_MODEL_KEY)
    await expect(resolveModelSelection(user.id, CUSTOM_VIDEO_MODEL_KEY, 'video')).resolves.toMatchObject({
      modelKey: CUSTOM_VIDEO_MODEL_KEY,
      provider: 'fal',
    })
  })
})
