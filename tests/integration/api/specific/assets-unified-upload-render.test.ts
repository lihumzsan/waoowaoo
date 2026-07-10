import {
  asRecord,
  authMock,
  beforeEach,
  buildFormRequest,
  copyAssetFromGlobalMock,
  createAssetMock,
  describe,
  executeProjectAgentOperationFromApiMock,
  expect,
  it,
  omitKeys,
  planProjectAgentOperationFromApiMock,
  readAssetsMock,
  readKind,
  readString,
  removeAssetMock,
  revertAssetRenderMock,
  selectAssetRenderMock,
  submitAssetGenerateTaskMock,
  updateAssetMock,
  updateAssetVariantMock,
  uploadProjectAssetRenderMock,
  vi,
} from './assets-unified.fixture'

describe('api specific - unified assets routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readAssetsMock.mockResolvedValue([{ id: 'asset-1', kind: 'character' }])
    submitAssetGenerateTaskMock.mockResolvedValue({ success: true, taskId: 'task-1' })
    executeProjectAgentOperationFromApiMock.mockImplementation(async (params: {
      request: Request
      operationId: string
      projectId: string
      userId: string
      input: unknown
    }) => {
      const input = asRecord(params.input)
      const scope = input.scope === 'global' || input.scope === 'project' ? input.scope : 'project'
      const kind = readKind(input.kind)
      const assetId = readString(input.assetId)
      const projectId = readString(input.projectId) || params.projectId
      const access = scope === 'project'
        ? { scope, userId: params.userId, projectId }
        : { scope, userId: params.userId }

      if (params.operationId === 'api_assets_read') {
        const readArgs = {
          scope,
          projectId: scope === 'project' ? projectId : null,
          folderId: typeof input.folderId === 'string' && input.folderId.trim() ? input.folderId : null,
          kind: input.kind ?? null,
        }
        const assets = scope === 'global'
          ? await readAssetsMock(readArgs, { userId: params.userId })
          : await readAssetsMock(readArgs)
        return { assets }
      }
      if (params.operationId === 'api_assets_create') {
        return await createAssetMock({ kind, body: input, access })
      }
      if (params.operationId === 'api_assets_update') {
        return await updateAssetMock({ kind, assetId, body: omitKeys(input, ['assetId']), access })
      }
      if (params.operationId === 'api_assets_remove') {
        return await removeAssetMock({ kind, assetId, access })
      }
      if (params.operationId === 'api_assets_generate') {
        return { success: true, taskId: 'task-1' }
      }
      if (params.operationId === 'api_assets_update_variant') {
        return await updateAssetVariantMock({
          kind,
          assetId,
          variantId: readString(input.variantId),
          body: omitKeys(input, ['assetId', 'variantId']),
          access,
        })
      }
      if (params.operationId === 'api_assets_select_render') {
        return await selectAssetRenderMock({ kind, assetId, body: omitKeys(input, ['assetId']), access })
      }
      if (params.operationId === 'api_assets_revert_render') {
        return await revertAssetRenderMock({ kind, assetId, body: omitKeys(input, ['assetId']), access })
      }
      if (params.operationId === 'api_assets_copy_from_global') {
        return await copyAssetFromGlobalMock({
          kind,
          targetId: assetId,
          globalAssetId: readString(input.globalAssetId),
          access: {
            userId: params.userId,
            projectId,
          },
        })
      }
      if (params.operationId === 'api_assets_upload_render') {
        const file = input.file instanceof Blob ? input.file : new Blob([])
        return await uploadProjectAssetRenderMock({
          userId: params.userId,
          projectId,
          kind,
          assetId,
          imageBuffer: Buffer.from(await file.arrayBuffer()),
          locale: 'zh',
          ...(typeof input.appearanceId === 'string' ? { appearanceId: input.appearanceId } : {}),
          ...(typeof input.imageIndex === 'number' ? { imageIndex: input.imageIndex } : {}),
        })
      }
      throw new Error(`TEST_OPERATION_UNHANDLED:${params.operationId}`)
    })
    planProjectAgentOperationFromApiMock.mockResolvedValue({
      operationId: 'api_assets_generate',
      kind: 'task_submission',
      taskCount: 1,
      quote: {
        showCredits: true,
        billingMode: 'ENFORCE',
        billable: true,
        taskCount: 1,
        mediaTaskCount: 1,
        totalMaxFrozenCost: 1,
        currency: 'credits',
        items: [],
      },
      tasks: [],
    })
    copyAssetFromGlobalMock.mockResolvedValue({ success: true })
    createAssetMock.mockResolvedValue({ success: true, assetId: 'prop-1' })
    updateAssetMock.mockResolvedValue({ success: true })
    removeAssetMock.mockResolvedValue({ success: true })
    updateAssetVariantMock.mockResolvedValue({ success: true })
    selectAssetRenderMock.mockResolvedValue({ success: true })
    revertAssetRenderMock.mockResolvedValue({ success: true })
    uploadProjectAssetRenderMock.mockResolvedValue({ success: true, imageKey: 'upload.jpg', imageIndex: 0 })
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
