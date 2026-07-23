import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTE_CATALOG } from '../../../contracts/route-catalog'
import { buildMockRequest } from '../../../helpers/request'

type RouteMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

type AuthState = {
  authenticated: boolean
}

type RouteContext = {
  params: Promise<Record<string, string>>
}

const authState = vi.hoisted<AuthState>(() => ({
  authenticated: false,
}))

const deleteObjectsMock = vi.hoisted(() => vi.fn())
const getMediaObjectsByStorageKeysMock = vi.hoisted(() => vi.fn())
const deleteMediaObjectIfUnreferencedMock = vi.hoisted(() => vi.fn())
const logInfoMock = vi.hoisted(() => vi.fn())
const logErrorMock = vi.hoisted(() => vi.fn())
const transactionMock = vi.hoisted(() => vi.fn())

const prismaMock = vi.hoisted(() => ({
  $transaction: transactionMock,
  project: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  novelPromotionEpisode: {
    findMany: vi.fn(),
  },
  globalCharacter: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  globalAssetFolder: {
    findUnique: vi.fn(),
  },
  characterAppearance: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionLocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  locationImage: {
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionClip: {
    update: vi.fn(),
  },
  novelPromotionStoryboard: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionPanel: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireUserAuth: async () => {
      if (!authState.authenticated) return unauthorized()
      return { session: { user: { id: 'user-1' } } }
    },
    requireProjectAuth: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1' },
      }
    },
    requireProjectAuthLight: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1' },
      }
    },
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/logging/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/logging/core')>(),
  logInfo: logInfoMock,
  logError: logErrorMock,
}))

vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(),
  deleteObjects: deleteObjectsMock,
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))

vi.mock('@/lib/media/service', () => ({
  getMediaObjectsByStorageKeys: getMediaObjectsByStorageKeysMock,
  resolveStorageKeyFromMediaValue: vi.fn(async (value: string) => value),
}))

vi.mock('@/lib/media/unreferenced-cleanup', () => ({
  deleteMediaObjectIfUnreferenced: deleteMediaObjectIfUnreferencedMock,
}))

function toModuleImportPath(routeFile: string): string {
  return `@/${routeFile.replace(/^src\//, '').replace(/\.ts$/, '')}`
}

function resolveParamValue(paramName: string): string {
  const key = paramName.toLowerCase()
  if (key.includes('project')) return 'project-1'
  if (key.includes('character')) return 'character-1'
  if (key.includes('location')) return 'location-1'
  if (key.includes('appearance')) return '0'
  if (key.includes('episode')) return 'episode-1'
  if (key.includes('storyboard')) return 'storyboard-1'
  if (key.includes('panel')) return 'panel-1'
  if (key.includes('clip')) return 'clip-1'
  if (key.includes('folder')) return 'folder-1'
  if (key === 'id') return 'id-1'
  return `${paramName}-1`
}

function toApiPath(routeFile: string): { path: string; params: Record<string, string> } {
  const withoutPrefix = routeFile
    .replace(/^src\/app/, '')
    .replace(/\/route\.ts$/, '')

  const params: Record<string, string> = {}
  const path = withoutPrefix.replace(/\[([^\]]+)\]/g, (_full, paramName: string) => {
    const value = resolveParamValue(paramName)
    params[paramName] = value
    return value
  })
  return { path, params }
}

function buildGenericBody() {
  return {
    id: 'id-1',
    name: 'Name',
    type: 'character',
    userInstruction: 'instruction',
    characterId: 'character-1',
    locationId: 'location-1',
    appearanceId: 'appearance-1',
    modifyPrompt: 'modify prompt',
    storyboardId: 'storyboard-1',
    panelId: 'panel-1',
    panelIndex: 0,
    episodeId: 'episode-1',
    content: 'x'.repeat(140),
    voicePrompt: 'voice prompt',
    previewText: 'preview text',
    referenceImageUrl: 'https://example.com/ref.png',
    referenceImageUrls: ['https://example.com/ref.png'],
    lineId: 'line-1',
    audioModel: 'comfyui::baseaudio/单人/LongCat-one',
    videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
    insertAfterPanelId: 'panel-1',
    sourcePanelId: 'panel-2',
    variant: { video_prompt: 'variant prompt' },
    currentDescription: 'description',
    modifyInstruction: 'instruction',
    currentPrompt: 'prompt',
    all: false,
  }
}

async function invokeRouteMethod(
  routeFile: string,
  method: RouteMethod,
): Promise<Response> {
  const { path, params } = toApiPath(routeFile)
  const modulePath = toModuleImportPath(routeFile)
  const mod = await import(modulePath)
  const handler = mod[method] as ((req: Request, ctx?: RouteContext) => Promise<Response>) | undefined
  if (!handler) {
    throw new Error(`Route ${routeFile} missing method ${method}`)
  }
  const req = buildMockRequest({
    path,
    method,
    ...(method === 'GET' ? {} : { body: buildGenericBody() }),
  })
  return await handler(req, { params: Promise.resolve(params) })
}

describe('api contract - crud routes (behavior)', () => {
  const routes = ROUTE_CATALOG.filter(
    (entry) => (
      entry.contractGroup === 'crud-assets-routes'
      || entry.contractGroup === 'crud-asset-hub-routes'
      || entry.contractGroup === 'crud-novel-promotion-routes'
    ),
  )

  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = false

    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
      name: 'Project 1',
      userId: 'user-1',
      user: { id: 'user-1' },
    })
    prismaMock.project.update.mockResolvedValue({ id: 'project-1' })
    prismaMock.project.delete.mockResolvedValue({ id: 'project-1' })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue(null)
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([])
    transactionMock.mockImplementation(async (callback) => await callback({
      project: { delete: prismaMock.project.delete },
      novelPromotionEpisode: { findMany: prismaMock.novelPromotionEpisode.findMany },
    }))
    deleteObjectsMock.mockResolvedValue({ success: 0, failed: 0 })
    getMediaObjectsByStorageKeysMock.mockResolvedValue(new Map())
    deleteMediaObjectIfUnreferencedMock.mockResolvedValue('deleted')

    prismaMock.globalCharacter.findUnique.mockResolvedValue({
      id: 'character-1',
      userId: 'user-1',
    })
    prismaMock.globalAssetFolder.findUnique.mockResolvedValue({
      id: 'folder-1',
      userId: 'user-1',
    })
    prismaMock.globalCharacter.update.mockResolvedValue({
      id: 'character-1',
      name: 'Alice',
      userId: 'user-1',
      appearances: [],
    })
    prismaMock.globalCharacter.delete.mockResolvedValue({ id: 'character-1' })
    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      id: 'appearance-1',
      characterId: 'character-1',
      imageUrls: JSON.stringify(['cos/char-0.png', 'cos/char-1.png']),
      imageUrl: null,
      selectedIndex: null,
      character: { id: 'character-1', name: 'Alice' },
    })
    prismaMock.characterAppearance.update.mockResolvedValue({
      id: 'appearance-1',
      selectedIndex: 1,
      imageUrl: 'cos/char-1.png',
    })
    prismaMock.novelPromotionLocation.findUnique.mockResolvedValue({
      id: 'location-1',
      name: 'Old Town',
      images: [
        { id: 'img-0', imageIndex: 0, imageUrl: 'cos/loc-0.png' },
        { id: 'img-1', imageIndex: 1, imageUrl: 'cos/loc-1.png' },
      ],
    })
    prismaMock.locationImage.updateMany.mockResolvedValue({ count: 2 })
    prismaMock.locationImage.update.mockResolvedValue({
      id: 'img-1',
      imageIndex: 1,
      imageUrl: 'cos/loc-1.png',
      isSelected: true,
    })
    prismaMock.novelPromotionLocation.update.mockResolvedValue({
      id: 'location-1',
      selectedImageId: 'img-1',
    })
    prismaMock.novelPromotionClip.update.mockResolvedValue({
      id: 'clip-1',
      characters: JSON.stringify(['Alice']),
      location: 'Old Town',
      props: JSON.stringify(['Bronze Dagger']),
      content: 'clip content',
      screenplay: JSON.stringify({ scenes: [{ id: 1 }] }),
    })
    prismaMock.novelPromotionStoryboard.findUnique.mockResolvedValue({
      id: 'storyboard-1',
      projectId: 'project-1',
    })
    prismaMock.novelPromotionStoryboard.update.mockResolvedValue({
      id: 'storyboard-1',
      panelCount: 1,
    })
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
    })
    prismaMock.novelPromotionPanel.update.mockResolvedValue({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      props: JSON.stringify(['Bronze Dagger']),
    })
    prismaMock.novelPromotionPanel.create.mockResolvedValue({
      id: 'panel-2',
      storyboardId: 'storyboard-1',
      panelIndex: 1,
      props: JSON.stringify(['Bronze Dagger']),
    })
    prismaMock.novelPromotionPanel.count.mockResolvedValue(1)
  })

  it('crud route group exists', () => {
    expect(routes.length).toBeGreaterThan(0)
  })

  it('all crud route methods reject unauthenticated requests (no 2xx pass-through)', async () => {
    const methods: ReadonlyArray<RouteMethod> = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
    let checkedMethodCount = 0

    for (const entry of routes) {
      const modulePath = toModuleImportPath(entry.routeFile)
      const mod = await import(modulePath)
      for (const method of methods) {
        if (typeof mod[method] !== 'function') continue
        checkedMethodCount += 1
        const res = await invokeRouteMethod(entry.routeFile, method)
        expect(res.status, `${entry.routeFile}#${method} should reject unauthenticated`).toBeGreaterThanOrEqual(400)
        expect(res.status, `${entry.routeFile}#${method} should not be server-error on auth gate`).toBeLessThan(500)
      }
    }

    expect(checkedMethodCount).toBeGreaterThan(0)
  })

  it('PATCH /asset-hub/characters/[characterId] writes normalized fields to prisma.globalCharacter.update', async () => {
    authState.authenticated = true
    const mod = await import('@/app/api/asset-hub/characters/[characterId]/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/characters/character-1',
      method: 'PATCH',
      body: {
        name: '  Alice  ',
        aliases: ['A'],
        profileConfirmed: true,
        folderId: 'folder-1',
      },
    })

    const res = await mod.PATCH(req, { params: Promise.resolve({ characterId: 'character-1' }) })
    expect(res.status).toBe(200)
    expect(prismaMock.globalCharacter.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'character-1' },
      data: expect.objectContaining({
        name: 'Alice',
        aliases: ['A'],
        profileConfirmed: true,
        folderId: 'folder-1',
      }),
    }))
  })

  it('DELETE /asset-hub/characters/[characterId] deletes owned character and blocks non-owner', async () => {
    authState.authenticated = true
    const mod = await import('@/app/api/asset-hub/characters/[characterId]/route')

    prismaMock.globalCharacter.findUnique.mockResolvedValueOnce({
      id: 'character-1',
      userId: 'user-1',
    })
    const okReq = buildMockRequest({
      path: '/api/asset-hub/characters/character-1',
      method: 'DELETE',
    })
    const okRes = await mod.DELETE(okReq, { params: Promise.resolve({ characterId: 'character-1' }) })
    expect(okRes.status).toBe(200)
    expect(prismaMock.globalCharacter.delete).toHaveBeenCalledWith({ where: { id: 'character-1' } })

    prismaMock.globalCharacter.findUnique.mockResolvedValueOnce({
      id: 'character-1',
      userId: 'other-user',
    })
    const forbiddenReq = buildMockRequest({
      path: '/api/asset-hub/characters/character-1',
      method: 'DELETE',
    })
    const forbiddenRes = await mod.DELETE(forbiddenReq, { params: Promise.resolve({ characterId: 'character-1' }) })
    expect(forbiddenRes.status).toBe(403)
  })

  it('POST /novel-promotion/[projectId]/select-character-image writes selectedIndex and imageUrl key', async () => {
    authState.authenticated = true
    const mod = await import('@/app/api/novel-promotion/[projectId]/select-character-image/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/select-character-image',
      method: 'POST',
      body: {
        characterId: 'character-1',
        appearanceId: 'appearance-1',
        selectedIndex: 1,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith({
      where: { id: 'appearance-1' },
      data: {
        selectedIndex: 1,
        imageUrl: 'cos/char-1.png',
      },
    })

    const payload = await res.json() as { success: boolean }
    expect(payload).toEqual({
      success: true,
    })
  })

  it('POST /novel-promotion/[projectId]/character/confirm-selection accepts request selectedIndex when persisted selection has not caught up', async () => {
    authState.authenticated = true
    const mod = await import('@/app/api/novel-promotion/[projectId]/character/confirm-selection/route')
    prismaMock.characterAppearance.findUnique.mockResolvedValueOnce({
      id: 'appearance-1',
      characterId: 'character-1',
      changeReason: 'default',
      imageUrls: JSON.stringify(['cos/char-0.png', 'cos/char-1.png']),
      imageUrl: null,
      descriptions: JSON.stringify(['desc-0', 'desc-1']),
      description: 'fallback description',
      selectedIndex: null,
      character: { id: 'character-1', name: 'Alice' },
    })
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/character/confirm-selection',
      method: 'POST',
      body: {
        characterId: 'character-1',
        appearanceId: 'appearance-1',
        selectedIndex: 1,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith({
      where: { id: 'appearance-1' },
      data: {
        imageUrl: 'cos/char-1.png',
        imageUrls: JSON.stringify(['cos/char-1.png']),
        selectedIndex: 0,
        description: 'desc-1',
        descriptions: JSON.stringify(['desc-1']),
      },
    })
  })

  it('POST /novel-promotion/[projectId]/select-location-image toggles selected state and selectedImageId', async () => {
    authState.authenticated = true
    const mod = await import('@/app/api/novel-promotion/[projectId]/select-location-image/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/select-location-image',
      method: 'POST',
      body: {
        locationId: 'location-1',
        selectedIndex: 1,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)
    expect(prismaMock.locationImage.updateMany).toHaveBeenCalledWith({
      where: { locationId: 'location-1' },
      data: { isSelected: false },
    })
    expect(prismaMock.locationImage.update).toHaveBeenCalledWith({
      where: { locationId_imageIndex: { locationId: 'location-1', imageIndex: 1 } },
      data: { isSelected: true },
    })
    expect(prismaMock.novelPromotionLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: { selectedImageId: 'img-1' },
    })
  })

  it('PATCH /novel-promotion/[projectId]/clips/[clipId] writes provided editable fields', async () => {
    authState.authenticated = true
    const mod = await import('@/app/api/novel-promotion/[projectId]/clips/[clipId]/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/clips/clip-1',
      method: 'PATCH',
      body: {
        characters: JSON.stringify(['Alice']),
        location: 'Old Town',
        props: JSON.stringify(['Bronze Dagger']),
        content: 'clip content',
        screenplay: JSON.stringify({ scenes: [{ id: 1 }] }),
      },
    })

    const res = await mod.PATCH(req, {
      params: Promise.resolve({ projectId: 'project-1', clipId: 'clip-1' }),
    })
    expect(res.status).toBe(200)
    expect(prismaMock.novelPromotionClip.update).toHaveBeenCalledWith({
      where: { id: 'clip-1' },
      data: {
        characters: JSON.stringify(['Alice']),
        location: 'Old Town',
        props: JSON.stringify(['Bronze Dagger']),
        content: 'clip content',
        screenplay: JSON.stringify({ scenes: [{ id: 1 }] }),
      },
    })
  })

  it('PUT /novel-promotion/[projectId]/panel writes provided props to prisma.novelPromotionPanel.update', async () => {
    authState.authenticated = true
    const mod = await import('@/app/api/novel-promotion/[projectId]/panel/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/panel',
      method: 'PUT',
      body: {
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        location: 'Old Town',
        characters: JSON.stringify(['Alice']),
        props: JSON.stringify(['Bronze Dagger']),
        description: 'panel description',
      },
    })

    const res = await mod.PUT(req, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(200)
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        location: 'Old Town',
        characters: JSON.stringify(['Alice']),
        props: JSON.stringify(['Bronze Dagger']),
        description: 'panel description',
      },
    })
  })

  it('retains current cover media when the same ID is derived from a legacy key', async () => {
    authState.authenticated = true
    const events: string[] = []
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [],
      locations: [],
      freeVoiceRecords: [],
      episodes: [{
        audioUrl: null,
        storyboards: [{
          storyboardImageUrl: null,
          candidateImages: JSON.stringify([
            'episode-cover/project-1-episode-1.png',
            'storyboards/project-1/legacy-candidate.png',
          ]),
          panels: [{
            imageUrl: 'episode-cover/project-1-episode-1.png',
            videoUrl: null,
          }],
        }],
      }],
    })
    getMediaObjectsByStorageKeysMock.mockImplementationOnce(async () => {
      events.push('outer-media-read')
      return new Map([[
        'episode-cover/project-1-episode-1.png',
        {
          id: 'media-cover-1',
          storageKey: 'episode-cover/project-1-episode-1.png',
        },
      ]])
    })
    prismaMock.novelPromotionEpisode.findMany.mockImplementationOnce(async () => {
      events.push('current-covers-read')
      return [
        {
          id: 'episode-1',
          coverImageMediaId: 'media-cover-1',
          coverImageMedia: { storageKey: 'episode-cover/project-1-episode-1.png' },
        },
        {
          id: 'episode-2',
          coverImageMediaId: 'media-cover-1',
          coverImageMedia: { storageKey: 'episode-cover/project-1-episode-1.png' },
        },
      ]
    })
    prismaMock.project.delete.mockImplementationOnce(async () => {
      events.push('project-deleted')
      return { id: 'project-1' }
    })
    transactionMock.mockImplementationOnce(async (callback) => {
      const result = await callback({
        project: { delete: prismaMock.project.delete },
        novelPromotionEpisode: { findMany: prismaMock.novelPromotionEpisode.findMany },
      })
      events.push('delete-transaction-committed')
      return result
    })
    const mod = await import('@/app/api/projects/[projectId]/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1',
      method: 'DELETE',
    })

    const res = await mod.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(200)
    expect(prismaMock.novelPromotionProject.findUnique).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      include: expect.objectContaining({
        episodes: {
          include: expect.objectContaining({
            storyboards: expect.any(Object),
          }),
        },
      }),
    })
    const collectionInclude = prismaMock.novelPromotionProject.findUnique.mock.calls[0]?.[0]?.include
    expect(collectionInclude.episodes.include).not.toHaveProperty('coverImageMedia')
    expect(prismaMock.novelPromotionEpisode.findMany).toHaveBeenCalledWith({
      where: { novelPromotionProject: { projectId: 'project-1' } },
      select: {
        id: true,
        coverImageMediaId: true,
        coverImageMedia: { select: { storageKey: true } },
      },
    })
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
    expect(getMediaObjectsByStorageKeysMock).not.toHaveBeenCalled()
    expect(deleteMediaObjectIfUnreferencedMock).not.toHaveBeenCalled()
    expect(deleteObjectsMock).not.toHaveBeenCalled()
    expect(logInfoMock).toHaveBeenCalledWith(
      '[DELETE] skipped project media cleanup because legacy reference inventory is incomplete',
      {
        projectId: 'project-1',
        skippedStorageKeyCount: 2,
        skippedMediaCount: 1,
      },
    )
    expect(events).toEqual([
      'current-covers-read',
      'project-deleted',
      'delete-transaction-committed',
    ])
  })

  it('retains a legacy key even when it is backed by media with no typed references', async () => {
    authState.authenticated = true
    const sharedKey = 'characters/shared/portrait.png'
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [{
        appearances: [{ imageUrl: sharedKey }],
      }],
      locations: [],
      freeVoiceRecords: [],
      episodes: [],
    })
    getMediaObjectsByStorageKeysMock.mockResolvedValueOnce(new Map([[
      sharedKey,
      {
        id: 'media-shared-by-project-b',
        storageKey: sharedKey,
      },
    ]]))
    deleteMediaObjectIfUnreferencedMock.mockResolvedValueOnce('deleted')

    const mod = await import('@/app/api/projects/[projectId]/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1',
      method: 'DELETE',
    })

    const res = await mod.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      cosFilesDeleted: 0,
      cosFilesFailed: 0,
    })
    expect(getMediaObjectsByStorageKeysMock).not.toHaveBeenCalled()
    expect(deleteObjectsMock).not.toHaveBeenCalled()
    expect(deleteMediaObjectIfUnreferencedMock).not.toHaveBeenCalled()
    expect(logInfoMock).toHaveBeenCalledWith(
      '[DELETE] skipped project media cleanup because legacy reference inventory is incomplete',
      {
        projectId: 'project-1',
        skippedStorageKeyCount: 1,
        skippedMediaCount: 0,
      },
    )
  })

  it('retains both legacy-derived M0 and transaction-current typed M1 after commit', async () => {
    authState.authenticated = true
    const events: string[] = []
    const m0StorageKey = 'episode-cover/project-1/m0.png'
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [],
      locations: [],
      freeVoiceRecords: [],
      episodes: [{
        audioUrl: null,
        storyboards: [{
          storyboardImageUrl: null,
          candidateImages: JSON.stringify([m0StorageKey, m0StorageKey]),
          panels: [{
            imageUrl: m0StorageKey,
            videoUrl: null,
          }],
        }],
      }],
    })
    getMediaObjectsByStorageKeysMock.mockImplementationOnce(async () => {
      events.push('outer-m0-read')
      return new Map([[
        m0StorageKey,
        {
          id: 'media-cover-m0',
          storageKey: m0StorageKey,
        },
      ]])
    })
    prismaMock.novelPromotionEpisode.findMany.mockImplementationOnce(async () => {
      events.push('transaction-m1-read')
      return [{
        id: 'episode-1',
        coverImageMediaId: 'media-cover-m1',
        coverImageMedia: { storageKey: 'episode-cover/project-1/m1.png' },
      }]
    })
    prismaMock.project.delete.mockImplementationOnce(async () => {
      events.push('project-deleted')
      return { id: 'project-1' }
    })
    transactionMock.mockImplementationOnce(async (callback) => {
      const result = await callback({
        project: { delete: prismaMock.project.delete },
        novelPromotionEpisode: { findMany: prismaMock.novelPromotionEpisode.findMany },
      })
      events.push('delete-transaction-committed')
      return result
    })
    deleteMediaObjectIfUnreferencedMock.mockImplementation(async (mediaId: string) => {
      events.push(`guarded-${mediaId}`)
      return 'referenced'
    })

    const mod = await import('@/app/api/projects/[projectId]/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1',
      method: 'DELETE',
    })

    const res = await mod.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(200)
    expect(getMediaObjectsByStorageKeysMock).not.toHaveBeenCalled()
    expect(deleteObjectsMock).not.toHaveBeenCalled()
    expect(deleteMediaObjectIfUnreferencedMock).not.toHaveBeenCalled()
    expect(logInfoMock).toHaveBeenCalledWith(
      '[DELETE] skipped project media cleanup because legacy reference inventory is incomplete',
      {
        projectId: 'project-1',
        skippedStorageKeyCount: 2,
        skippedMediaCount: 1,
      },
    )
    expect(events).toEqual([
      'transaction-m1-read',
      'project-deleted',
      'delete-transaction-committed',
    ])
  })

  it('retains unmatched pure-legacy keys when cross-project reference inventory is incomplete', async () => {
    authState.authenticated = true
    const sharedLegacyKey = 'legacy/shared-by-project-b.png'
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [{
        appearances: [
          { imageUrl: sharedLegacyKey },
          { imageUrl: sharedLegacyKey },
        ],
      }],
      locations: [],
      freeVoiceRecords: [],
      episodes: [],
    })

    const mod = await import('@/app/api/projects/[projectId]/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1',
      method: 'DELETE',
    })

    const res = await mod.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      cosFilesDeleted: 0,
      cosFilesFailed: 0,
    })
    expect(getMediaObjectsByStorageKeysMock).not.toHaveBeenCalled()
    expect(deleteObjectsMock).not.toHaveBeenCalled()
    expect(deleteMediaObjectIfUnreferencedMock).not.toHaveBeenCalled()
    expect(logInfoMock).toHaveBeenCalledWith(
      '[DELETE] skipped project media cleanup because legacy reference inventory is incomplete',
      {
        projectId: 'project-1',
        skippedStorageKeyCount: 1,
        skippedMediaCount: 0,
      },
    )
  })

  it('deduplicates a retained current cover media ID in skipped cleanup counts', async () => {
    authState.authenticated = true
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [],
      locations: [],
      freeVoiceRecords: [],
      episodes: [],
    })
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValueOnce([
      {
        id: 'episode-1',
        coverImageMediaId: 'media-cover-shared',
        coverImageMedia: { storageKey: 'episode-cover/project-1/shared.png' },
      },
      {
        id: 'episode-2',
        coverImageMediaId: 'media-cover-shared',
        coverImageMedia: { storageKey: 'episode-cover/project-1/shared.png' },
      },
    ])

    const mod = await import('@/app/api/projects/[projectId]/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1',
      method: 'DELETE',
    })

    const res = await mod.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(200)
    expect(deleteObjectsMock).not.toHaveBeenCalled()
    expect(deleteMediaObjectIfUnreferencedMock).not.toHaveBeenCalled()
    expect(logInfoMock).toHaveBeenCalledWith(
      '[DELETE] skipped project media cleanup because legacy reference inventory is incomplete',
      {
        projectId: 'project-1',
        skippedStorageKeyCount: 1,
        skippedMediaCount: 1,
      },
    )
  })

  it('does not start post-commit cleanup when the project delete transaction fails', async () => {
    authState.authenticated = true
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [],
      locations: [],
      freeVoiceRecords: [],
      episodes: [],
    })
    transactionMock.mockRejectedValueOnce(new Error('delete transaction failed'))

    const mod = await import('@/app/api/projects/[projectId]/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1',
      method: 'DELETE',
    })

    const res = await mod.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(500)
    expect(deleteObjectsMock).not.toHaveBeenCalled()
    expect(deleteMediaObjectIfUnreferencedMock).not.toHaveBeenCalled()
  })

  it('retains multiple current covers and preserves zero cleanup counts', async () => {
    authState.authenticated = true
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [],
      locations: [],
      freeVoiceRecords: [],
      episodes: [],
    })
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValueOnce([
      {
        id: 'episode-1',
        coverImageMediaId: 'media-cover-1',
        coverImageMedia: { storageKey: 'episode-cover/one.png' },
      },
      {
        id: 'episode-2',
        coverImageMediaId: 'media-cover-2',
        coverImageMedia: { storageKey: 'episode-cover/two.png' },
      },
    ])
    deleteMediaObjectIfUnreferencedMock
      .mockRejectedValueOnce(new Error('serializable cleanup failed'))
      .mockResolvedValueOnce('deleted')

    const mod = await import('@/app/api/projects/[projectId]/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1',
      method: 'DELETE',
    })

    const res = await mod.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      cosFilesDeleted: 0,
      cosFilesFailed: 0,
    })
    expect(deleteMediaObjectIfUnreferencedMock).not.toHaveBeenCalled()
    expect(logInfoMock).toHaveBeenCalledWith(
      '[DELETE] skipped project media cleanup because legacy reference inventory is incomplete',
      {
        projectId: 'project-1',
        skippedStorageKeyCount: 2,
        skippedMediaCount: 2,
      },
    )
  })

  it('retains a current typed cover when another project may have only a legacy string reference', async () => {
    authState.authenticated = true
    const events: string[] = []
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [],
      locations: [],
      freeVoiceRecords: [],
      episodes: [],
    })
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValueOnce([{
      id: 'episode-current',
      coverImageMediaId: 'media-cover-current',
      coverImageMedia: { storageKey: 'episode-cover/project-1/current.png' },
    }])
    prismaMock.project.delete.mockImplementationOnce(async () => {
      events.push('project-deleted')
      return { id: 'project-1' }
    })
    transactionMock.mockImplementationOnce(async (callback) => {
      const result = await callback({
        project: { delete: prismaMock.project.delete },
        novelPromotionEpisode: { findMany: prismaMock.novelPromotionEpisode.findMany },
      })
      events.push('delete-transaction-committed')
      return result
    })
    deleteObjectsMock.mockImplementationOnce(async () => {
      events.push('bulk-storage-cleanup-attempted')
      throw new Error('storage unavailable')
    })
    deleteMediaObjectIfUnreferencedMock.mockImplementationOnce(async () => {
      events.push('guarded-media-cleanup-attempted')
      const error = new Error('storage unavailable') as Error & { storageKey: string }
      error.storageKey = 'episode-cover/project-1/current.png'
      throw error
    })

    const mod = await import('@/app/api/projects/[projectId]/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1',
      method: 'DELETE',
    })

    const res = await mod.DELETE(req, {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      cosFilesDeleted: 0,
      cosFilesFailed: 0,
    })
    expect(deleteObjectsMock).not.toHaveBeenCalled()
    expect(deleteMediaObjectIfUnreferencedMock).not.toHaveBeenCalled()
    expect(logInfoMock).toHaveBeenCalledWith(
      '[DELETE] skipped project media cleanup because legacy reference inventory is incomplete',
      {
        projectId: 'project-1',
        skippedStorageKeyCount: 1,
        skippedMediaCount: 1,
      },
    )
    expect(events).toEqual([
      'project-deleted',
      'delete-transaction-committed',
    ])
  })
})
