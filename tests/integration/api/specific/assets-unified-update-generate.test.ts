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

  it('POST /api/assets/[assetId]/generate forwards project asset generation to the operation runtime', async () => {
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
    expect(executeProjectAgentOperationFromApiMock).toHaveBeenCalledWith({
      request: req,
      operationId: 'api_assets_generate',
      projectId: 'project-1',
      userId: 'user-1',
      input: {
        assetId: 'asset-1',
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        episodeId: 'episode-1',
        appearanceId: 'appearance-1',
        count: 2,
      },
      source: 'project-ui',
    })
    expect(body).toEqual({ success: true, taskId: 'task-1' })
  })
})
