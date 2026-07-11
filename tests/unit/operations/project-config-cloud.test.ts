import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))
const mediaAttachMock = vi.hoisted(() => ({
  attachMediaFieldsToProject: vi.fn(),
}))
const projectReadModelMock = vi.hoisted(() => ({
  buildProjectReadModel: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/semantic', () => ({ logProjectAction: vi.fn() }))
vi.mock('@/lib/media/attach', () => mediaAttachMock)
vi.mock('@/lib/projects/build-project-read-model', () => projectReadModelMock)

import { createConfigOperations } from '@/lib/operations/domains/config/config-ops'

function buildContext() {
  return {
    request: new Request('http://localhost/api/projects/project-1/config') as unknown as NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    context: {},
    source: 'test',
    writer: null,
  }
}

describe('project config operations in cloud deployment', () => {
  const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION
  const originalProviderCredentialMode = process.env.PROVIDER_CREDENTIAL_MODE

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    mediaAttachMock.attachMediaFieldsToProject.mockImplementation(async (project: unknown) => project)
    projectReadModelMock.buildProjectReadModel.mockImplementation((project: unknown) => project)
  })

  afterEach(() => {
    if (originalDeploymentEdition === undefined) {
      delete process.env.DEPLOYMENT_EDITION
    } else {
      process.env.DEPLOYMENT_EDITION = originalDeploymentEdition
    }
    if (originalProviderCredentialMode === undefined) {
      delete process.env.PROVIDER_CREDENTIAL_MODE
    } else {
      process.env.PROVIDER_CREDENTIAL_MODE = originalProviderCredentialMode
    }
  })

  it('returns a non-configurable project config without reading project model fields', async () => {
    const result = await createConfigOperations().get_project_config.execute!(buildContext(), {})

    expect(result).toMatchObject({
      configurable: false,
      capabilityOverrides: {},
      deployment: {
        isCloud: true,
        usesPlatformProviderKeys: true,
      },
    })
    expect(prismaMock.project.findUnique.mock.calls).toEqual([])
  })

  it('allows project-owned video ratio writes in cloud mode', async () => {
    const projectRow = {
      id: 'project-1',
      name: 'Cloud Project',
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      singleShotVideoModel: null,
      sequenceVideoModel: null,
      musicModel: null,
    }
    const updatedProject = {
      ...projectRow,
      videoRatio: '9:16',
    }
    prismaMock.project.findUnique.mockResolvedValue(projectRow)
    prismaMock.project.update.mockResolvedValue(updatedProject)

    const result = await createConfigOperations().update_project_config.executeInTransaction!(
      buildContext(),
      { videoRatio: '9:16' },
      prismaMock as unknown as Prisma.TransactionClient,
    )

    expect(prismaMock.project.update.mock.calls).toEqual([
      [
        {
          where: { id: 'project-1' },
          data: { videoRatio: '9:16' },
        },
      ],
    ])
    expect(result).toEqual({ project: updatedProject })
  })

  it('rejects platform-managed model config writes in cloud mode', async () => {
    await expect(
      createConfigOperations().update_project_config.executeInTransaction!(
        buildContext(),
        { editModel: 'openrouter::anthropic/claude-sonnet-4.6' },
        prismaMock as unknown as Prisma.TransactionClient,
      ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: expect.objectContaining({
        code: 'PROJECT_CONFIG_MANAGED_BY_PLATFORM',
        field: 'editModel',
      }),
    })
    expect(prismaMock.project.findUnique.mock.calls).toEqual([])
    expect(prismaMock.project.update.mock.calls).toEqual([])
  })
})
