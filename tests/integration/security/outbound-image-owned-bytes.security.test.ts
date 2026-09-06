import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_IMAGE_BYTES } from '@/lib/http/body-size-constants'
import { readOwnedImageBytesForGeneration } from '@/lib/media/outbound-image'
import { createWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

type StorageFixture = {
  readonly bytes: Buffer
  readonly contentType: string
  readonly contentLength: number
}

const storageFixtures = vi.hoisted(() => new Map<string, StorageFixture>())
const storageMocks = vi.hoisted(() => ({
  getObjectBuffer: vi.fn(async (key: string) => {
    const fixture = storageFixtures.get(key)
    if (!fixture) throw new Error(`TEST_STORAGE_OBJECT_MISSING:${key}`)
    return Buffer.from(fixture.bytes)
  }),
  getObjectMetadata: vi.fn(async (key: string) => {
    const fixture = storageFixtures.get(key)
    if (!fixture) throw new Error(`TEST_STORAGE_OBJECT_MISSING:${key}`)
    return {
      contentLength: fixture.contentLength,
      contentType: fixture.contentType,
    }
  }),
}))

vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>()
  return {
    ...actual,
    getObjectBuffer: storageMocks.getObjectBuffer,
    getObjectMetadata: storageMocks.getObjectMetadata,
  }
})

describe('owned outbound image bytes security', () => {
  const resourceIds: string[] = []
  const mediaIds: string[] = []
  let ownerUserId = ''
  let foreignUserId = ''
  let projectId = ''
  let validMediaRoute = ''
  let invalidMediaRoute = ''
  let oversizedMediaRoute = ''

  async function seedReadyImage(input: {
    readonly label: string
    readonly fixture: StorageFixture
  }): Promise<string> {
    const storageKey = `tests/outbound-owned-image/${randomUUID()}-${input.label}.png`
    const publicId = `owned-image-${randomUUID()}`
    const media = await prisma.mediaObject.create({
      data: {
        publicId,
        storageKey,
        mimeType: input.fixture.contentType,
        sizeBytes: BigInt(input.fixture.contentLength),
      },
    })
    const resourceId = createWorkspaceResourceId()
    const workspacePath = `security/${input.label}-${resourceId}.png`
    await prisma.workspaceResource.create({
      data: {
        id: resourceId,
        userId: ownerUserId,
        projectId,
        workspacePath,
        activePath: workspacePath,
        resourceKind: 'file',
        mediaType: 'image',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
        name: `${input.label}.png`,
        status: 'ready',
        currentVersion: 1,
        materializedAt: new Date(),
        versions: {
          create: {
            version: 1,
            contentKind: 'media',
            mediaId: media.id,
            sizeBytes: BigInt(input.fixture.contentLength),
          },
        },
      },
    })
    storageFixtures.set(storageKey, input.fixture)
    resourceIds.push(resourceId)
    mediaIds.push(media.id)
    return `/m/${publicId}`
  }

  beforeAll(async () => {
    const owner = await createTestUser()
    const foreign = await createTestUser()
    const project = await createTestProject(owner.id)
    ownerUserId = owner.id
    foreignUserId = foreign.id
    projectId = project.id
    validMediaRoute = await seedReadyImage({
      label: 'valid',
      fixture: {
        bytes: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          0x00, 0x00, 0x00, 0x0d,
        ]),
        contentType: 'image/png',
        contentLength: 12,
      },
    })
    invalidMediaRoute = await seedReadyImage({
      label: 'invalid-mime',
      fixture: {
        bytes: Buffer.from('not an image', 'utf8'),
        contentType: 'image/png',
        contentLength: 12,
      },
    })
    oversizedMediaRoute = await seedReadyImage({
      label: 'oversized',
      fixture: {
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        contentType: 'image/png',
        contentLength: MAX_IMAGE_BYTES + 1,
      },
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(async () => {
    await prisma.workspaceResource.deleteMany({ where: { id: { in: resourceIds } } })
    await prisma.project.deleteMany({ where: { id: projectId } })
    await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, foreignUserId] } } })
    await prisma.mediaObject.deleteMany({ where: { id: { in: mediaIds } } })
    storageFixtures.clear()
  })

  it('returns detected bytes only to the resource owner', async () => {
    const result = await readOwnedImageBytesForGeneration(validMediaRoute, ownerUserId)

    expect(result).toEqual({
      bytes: new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d,
      ]),
      contentType: 'image/png',
    })
    expect(storageMocks.getObjectMetadata).toHaveBeenCalledTimes(1)
    expect(storageMocks.getObjectBuffer).toHaveBeenCalledTimes(1)
  })

  it('rejects a foreign owner before reading object storage', async () => {
    await expect(readOwnedImageBytesForGeneration(validMediaRoute, foreignUserId)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NOT_FOUND',
      details: { code: 'MEDIA_NOT_FOUND' },
    })
    expect(storageMocks.getObjectMetadata).not.toHaveBeenCalled()
    expect(storageMocks.getObjectBuffer).not.toHaveBeenCalled()
  })

  it('rejects bytes whose detected MIME is not an image', async () => {
    await expect(readOwnedImageBytesForGeneration(invalidMediaRoute, ownerUserId)).rejects.toMatchObject({
      code: 'OUTBOUND_IMAGE_FETCH_FAILED',
      cause: { code: 'OWNED_MEDIA_FORMAT_UNSUPPORTED' },
    })
  })

  it('rejects an oversized object from metadata without reading its body', async () => {
    await expect(readOwnedImageBytesForGeneration(oversizedMediaRoute, ownerUserId)).rejects.toMatchObject({
      code: 'OUTBOUND_IMAGE_FETCH_FAILED',
      cause: { code: 'OWNED_MEDIA_SIZE_EXCEEDED' },
    })
    expect(storageMocks.getObjectMetadata).toHaveBeenCalledTimes(1)
    expect(storageMocks.getObjectBuffer).not.toHaveBeenCalled()
  })
})
