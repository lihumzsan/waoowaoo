import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY } from '@/lib/ai-providers/comfyui/models'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { getPlatformModels } from '@/lib/platform-models/catalog'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

const CUSTOM_VIDEO_MODEL_KEY = 'fal::custom-video'
const ORIGINAL_DEPLOYMENT_EDITION = process.env.DEPLOYMENT_EDITION
const ORIGINAL_PROVIDER_CREDENTIAL_MODE = process.env.PROVIDER_CREDENTIAL_MODE

function restoreEnvironment(name: 'DEPLOYMENT_EDITION' | 'PROVIDER_CREDENTIAL_MODE', value: string | undefined) {
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
    await resetBillingState()
  })

  afterAll(() => {
    restoreEnvironment('DEPLOYMENT_EDITION', ORIGINAL_DEPLOYMENT_EDITION)
    restoreEnvironment('PROVIDER_CREDENTIAL_MODE', ORIGINAL_PROVIDER_CREDENTIAL_MODE)
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
