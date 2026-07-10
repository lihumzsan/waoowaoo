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
})
