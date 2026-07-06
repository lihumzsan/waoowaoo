import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { ProjectAgentContext } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'

const prismaMock = vi.hoisted(() => ({
  projectCharacter: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  characterAppearance: {
    create: vi.fn(),
  },
  projectLocation: {
    findFirst: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  locationImage: {
    createMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (project: Record<string, unknown>) => project),
}))

vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(async () => undefined),
}))

vi.mock('@/lib/logging/core', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return {
    logError: vi.fn(),
    createScopedLogger: vi.fn(() => logger),
  }
})

import { createGuiOperations } from '@/lib/operations/domains/gui/gui-ops'

function buildCtx(): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost') as unknown as NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    context: {} as ProjectAgentContext,
    source: 'assistant-panel',
    writer: null,
  }
}

describe('GUI asset creation conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects duplicate character names before creating records', async () => {
    prismaMock.projectCharacter.findFirst.mockResolvedValueOnce({ id: 'character-1' })
    const operation = createGuiOperations().create_character
    if (!operation?.execute) throw new Error('create_character operation missing')

    await expect(operation.execute(buildCtx(), {
      name: 'Hero',
      description: 'A lead character.',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: expect.objectContaining({
        code: 'PROJECT_CHARACTER_NAME_CONFLICT',
        field: 'name',
      }),
    })

    expect(prismaMock.projectCharacter.create).not.toHaveBeenCalled()
    expect(prismaMock.characterAppearance.create).not.toHaveBeenCalled()
  })

  it('rejects duplicate location names before creating records', async () => {
    prismaMock.projectLocation.findFirst.mockResolvedValueOnce({ id: 'location-1' })
    const operation = createGuiOperations().create_location
    if (!operation?.execute) throw new Error('create_location operation missing')

    await expect(operation.execute(buildCtx(), {
      name: 'Studio',
      description: 'A compact interview room.',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: expect.objectContaining({
        code: 'PROJECT_LOCATION_NAME_CONFLICT',
        field: 'name',
      }),
    })

    expect(prismaMock.projectLocation.create).not.toHaveBeenCalled()
    expect(prismaMock.locationImage.createMany).not.toHaveBeenCalled()
  })
})
