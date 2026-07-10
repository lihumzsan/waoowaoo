import {
  asRecord,
  authMock,
  beforeEach,
  buildMockRequest,
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
})
