import {
  EFFECTS_BILLABLE,
  EFFECTS_WRITE,
  beforeEach,
  buildBillablePlan,
  buildRequest,
  describe,
  executeProjectAgentOperationFromApi,
  expect,
  it,
  makeTestOperation,
  registryState,
  vi,
  z,
} from './api-adapter.fixture'

describe('executeProjectAgentOperationFromApi', () => {
  beforeEach(() => {
    registryState.registry = {}
    vi.clearAllMocks()
  })

  it('[requiresConfirmation sideEffects] -> does not enforce confirmed gate', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      confirm_semantics_op: makeTestOperation({
        id: 'confirm_semantics_op',
        summary: 'confirm semantics',
        intent: 'act',
        effects: EFFECTS_WRITE,
        confirmation: {
          kind: 'destructive',
          required: true,
          summary: 'requires explicit confirmation',
        },
        inputSchema: z.object({ confirmed: z.boolean().optional() }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'confirm_semantics_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    expect(result).toEqual({ ok: true })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(expect.any(Object), {})
  })

})
