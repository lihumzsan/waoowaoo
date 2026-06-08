import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  requireProjectAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1' },
  })),
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const readAssetsMock = vi.hoisted(() => vi.fn())
const submitAssetGenerateTaskMock = vi.hoisted(() => vi.fn())
const copyAssetFromGlobalMock = vi.hoisted(() => vi.fn())
const createAssetMock = vi.hoisted(() => vi.fn())
const updateAssetMock = vi.hoisted(() => vi.fn())
const removeAssetMock = vi.hoisted(() => vi.fn())
const updateAssetVariantMock = vi.hoisted(() => vi.fn())
const selectAssetRenderMock = vi.hoisted(() => vi.fn())
const revertAssetRenderMock = vi.hoisted(() => vi.fn())
const uploadProjectAssetRenderMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/assets/services/read-assets', () => ({
  readAssets: readAssetsMock,
}))
vi.mock('@/lib/assets/services/asset-actions', () => ({
  createAsset: createAssetMock,
  submitAssetGenerateTask: submitAssetGenerateTaskMock,
  copyAssetFromGlobal: copyAssetFromGlobalMock,
  updateAsset: updateAssetMock,
  removeAsset: removeAssetMock,
  updateAssetVariant: updateAssetVariantMock,
  submitAssetModifyTask: vi.fn(),
  selectAssetRender: selectAssetRenderMock,
  revertAssetRender: revertAssetRenderMock,
}))
vi.mock('@/lib/assets/services/project-upload-render', () => ({
  uploadProjectAssetRender: uploadProjectAssetRenderMock,
}))

function buildFormRequest(path: string, formData: FormData) {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Accept-Language': 'zh' },
    body: formData,
  })
}

describe('api specific - unified assets routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readAssetsMock.mockResolvedValue([{ id: 'asset-1', kind: 'character' }])
    submitAssetGenerateTaskMock.mockResolvedValue({ success: true, taskId: 'task-1' })
    copyAssetFromGlobalMock.mockResolvedValue({ success: true })
    createAssetMock.mockResolvedValue({ success: true, assetId: 'prop-1' })
    updateAssetMock.mockResolvedValue({ success: true })
    removeAssetMock.mockResolvedValue({ success: true })
    updateAssetVariantMock.mockResolvedValue({ success: true })
    selectAssetRenderMock.mockResolvedValue({ success: true })
    revertAssetRenderMock.mockResolvedValue({ success: true })
    uploadProjectAssetRenderMock.mockResolvedValue({ success: true, imageKey: 'upload.jpg', imageIndex: 0 })
  })

  it('GET /api/assets reads global assets with the authenticated user scope', async () => {
    const mod = await import('@/app/api/assets/route')
    const req = buildMockRequest({
      path: '/api/assets?scope=global&kind=character',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({}) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(authMock.requireUserAuth).toHaveBeenCalled()
    expect(readAssetsMock).toHaveBeenCalledWith({
      scope: 'global',
      projectId: null,
      folderId: null,
      kind: 'character',
    }, {
      userId: 'user-1',
    })
    expect(body).toEqual({ assets: [{ id: 'asset-1', kind: 'character' }] })
  })

  it('GET /api/assets reads prop assets through the unified filter contract', async () => {
    readAssetsMock.mockResolvedValue([{ id: 'prop-1', kind: 'prop' }])
    const mod = await import('@/app/api/assets/route')
    const req = buildMockRequest({
      path: '/api/assets?scope=project&projectId=project-1&kind=prop',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({}) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1')
    expect(readAssetsMock).toHaveBeenCalledWith({
      scope: 'project',
      projectId: 'project-1',
      folderId: null,
      kind: 'prop',
    })
    expect(body).toEqual({ assets: [{ id: 'prop-1', kind: 'prop' }] })
  })

  it('POST /api/assets creates a project prop through the centralized asset action service', async () => {
    const mod = await import('@/app/api/assets/route')
    const req = buildMockRequest({
      path: '/api/assets',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'prop',
        projectId: 'project-1',
        name: '青铜匕首',
        summary: '古旧短刃，雕纹手柄',
        description: '一把短小青铜匕首，雕纹手柄，刃面磨损发暗',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(createAssetMock).toHaveBeenCalledWith({
      kind: 'prop',
      body: {
        scope: 'project',
        kind: 'prop',
        projectId: 'project-1',
        name: '青铜匕首',
        summary: '古旧短刃，雕纹手柄',
        description: '一把短小青铜匕首，雕纹手柄，刃面磨损发暗',
      },
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })
    expect(body).toEqual({ success: true, assetId: 'prop-1' })
  })

  it('PATCH /api/assets/[assetId] updates a global prop through the unified route', async () => {
    const mod = await import('@/app/api/assets/[assetId]/route')
    const req = buildMockRequest({
      path: '/api/assets/prop-1',
      method: 'PATCH',
      body: {
        scope: 'global',
        kind: 'prop',
        name: '青铜短刃',
        summary: '更锋利的版本',
      },
    })

    const res = await mod.PATCH(req, {
      params: Promise.resolve({ assetId: 'prop-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(authMock.requireUserAuth).toHaveBeenCalled()
    expect(updateAssetMock).toHaveBeenCalledWith({
      kind: 'prop',
      assetId: 'prop-1',
      body: {
        scope: 'global',
        kind: 'prop',
        name: '青铜短刃',
        summary: '更锋利的版本',
      },
      access: {
        scope: 'global',
        userId: 'user-1',
      },
    })
    expect(body).toEqual({ success: true })
  })

  it('DELETE /api/assets/[assetId] removes a project prop through the unified route', async () => {
    const mod = await import('@/app/api/assets/[assetId]/route')
    const req = buildMockRequest({
      path: '/api/assets/prop-1',
      method: 'DELETE',
      body: {
        scope: 'project',
        kind: 'prop',
        projectId: 'project-1',
      },
    })

    const res = await mod.DELETE(req, {
      params: Promise.resolve({ assetId: 'prop-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(removeAssetMock).toHaveBeenCalledWith({
      kind: 'prop',
      assetId: 'prop-1',
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })
    expect(body).toEqual({ success: true })
  })

  it('POST /api/assets/[assetId]/generate forwards project asset generation to the unified service', async () => {
    const mod = await import('@/app/api/assets/[assetId]/generate/route')
    const req = buildMockRequest({
      path: '/api/assets/asset-1/generate',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        episodeId: 'episode-1',
        appearanceId: 'appearance-1',
        count: 2,
      },
    })

    const res = await mod.POST(req, {
      params: Promise.resolve({ assetId: 'asset-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1')
    expect(submitAssetGenerateTaskMock).toHaveBeenCalledWith({
      request: req,
      kind: 'character',
      assetId: 'asset-1',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        episodeId: 'episode-1',
        appearanceId: 'appearance-1',
        count: 2,
      },
      episodeId: 'episode-1',
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })
    expect(body).toEqual({ success: true, taskId: 'task-1' })
  })

  it('PATCH /api/assets/[assetId]/variants/[variantId] updates a prop variant through the unified route', async () => {
    const mod = await import('@/app/api/assets/[assetId]/variants/[variantId]/route')
    const req = buildMockRequest({
      path: '/api/assets/prop-1/variants/prop-image-1',
      method: 'PATCH',
      body: {
        scope: 'project',
        kind: 'prop',
        projectId: 'project-1',
        description: '古旧短刃，雕纹手柄',
      },
    })

    const res = await mod.PATCH(req, {
      params: Promise.resolve({ assetId: 'prop-1', variantId: 'prop-image-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(updateAssetVariantMock).toHaveBeenCalledWith({
      kind: 'prop',
      assetId: 'prop-1',
      variantId: 'prop-image-1',
      body: {
        scope: 'project',
        kind: 'prop',
        projectId: 'project-1',
        description: '古旧短刃，雕纹手柄',
      },
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })
    expect(body).toEqual({ success: true })
  })

  it('POST /api/assets/[assetId]/select-render confirms a project prop through the unified route', async () => {
    const mod = await import('@/app/api/assets/[assetId]/select-render/route')
    const req = buildMockRequest({
      path: '/api/assets/prop-1/select-render',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'prop',
        projectId: 'project-1',
        confirm: true,
      },
    })

    const res = await mod.POST(req, {
      params: Promise.resolve({ assetId: 'prop-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1')
    expect(selectAssetRenderMock).toHaveBeenCalledWith({
      kind: 'prop',
      assetId: 'prop-1',
      body: {
        scope: 'project',
        kind: 'prop',
        projectId: 'project-1',
        confirm: true,
      },
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })
    expect(body).toEqual({ success: true })
  })

  it('POST /api/assets/[assetId]/copy delegates prop copy to the centralized copy service', async () => {
    const mod = await import('@/app/api/assets/[assetId]/copy/route')
    const req = buildMockRequest({
      path: '/api/assets/prop-target-1/copy',
      method: 'POST',
      body: {
        kind: 'prop',
        projectId: 'project-1',
        globalAssetId: 'prop-global-1',
      },
    })

    const res = await mod.POST(req, {
      params: Promise.resolve({ assetId: 'prop-target-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(copyAssetFromGlobalMock).toHaveBeenCalledWith({
      kind: 'prop',
      targetId: 'prop-target-1',
      globalAssetId: 'prop-global-1',
      access: {
        userId: 'user-1',
        projectId: 'project-1',
      },
    })
    expect(body).toEqual({ success: true })
  })

  it('POST /api/assets/[assetId]/upload-render uploads a project character render', async () => {
    const mod = await import('@/app/api/assets/[assetId]/upload-render/route')
    const formData = new FormData()
    formData.append('scope', 'project')
    formData.append('kind', 'character')
    formData.append('projectId', 'project-1')
    formData.append('appearanceId', 'appearance-1')
    formData.append('imageIndex', '0')
    formData.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'character.png')

    const res = await mod.POST(buildFormRequest('/api/assets/character-1/upload-render', formData), {
      params: Promise.resolve({ assetId: 'character-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1')
    expect(uploadProjectAssetRenderMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      kind: 'character',
      assetId: 'character-1',
      imageBuffer: expect.any(Buffer),
      appearanceId: 'appearance-1',
      imageIndex: 0,
    }))
    expect(body).toEqual({ success: true, imageKey: 'upload.jpg', imageIndex: 0 })
  })

  it('POST /api/assets/[assetId]/upload-render uploads a project location render', async () => {
    const mod = await import('@/app/api/assets/[assetId]/upload-render/route')
    const formData = new FormData()
    formData.append('scope', 'project')
    formData.append('kind', 'location')
    formData.append('projectId', 'project-1')
    formData.append('imageIndex', '2')
    formData.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'location.png')

    const res = await mod.POST(buildFormRequest('/api/assets/location-1/upload-render', formData), {
      params: Promise.resolve({ assetId: 'location-1' }),
    })

    expect(res.status).toBe(200)
    expect(uploadProjectAssetRenderMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      kind: 'location',
      assetId: 'location-1',
      imageIndex: 2,
    }))
  })

  it('POST /api/assets/[assetId]/upload-render rejects missing character appearanceId', async () => {
    const mod = await import('@/app/api/assets/[assetId]/upload-render/route')
    const formData = new FormData()
    formData.append('scope', 'project')
    formData.append('kind', 'character')
    formData.append('projectId', 'project-1')
    formData.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'character.png')

    const res = await mod.POST(buildFormRequest('/api/assets/character-1/upload-render', formData), {
      params: Promise.resolve({ assetId: 'character-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(uploadProjectAssetRenderMock).not.toHaveBeenCalled()
  })
})
