import {
  EFFECTS_BILLABLE,
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

  it('[planned billable operation with confirmation] -> commits the exact plan without calling execute', async () => {
    const plan = vi.fn(async () => buildBillablePlan())
    const commit = vi.fn(async () => ({ ok: true }))
    const execute = vi.fn(async () => ({ ok: false }))
    registryState.registry = {
      planned_billable_op: makeTestOperation({
        id: 'planned_billable_op',
        summary: 'planned billable operation',
        intent: 'act',
        effects: EFFECTS_BILLABLE,
        confirmation: { kind: 'billable_media', required: true },
        inputSchema: z.object({ confirmed: z.boolean(), confirmedMaxCost: z.number() }),
        outputSchema: z.object({ ok: z.boolean() }),
        plan,
        commit,
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'planned_billable_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: { confirmed: true, confirmedMaxCost: 1 },
      source: 'project-ui',
    })

    expect(result).toEqual({ ok: true })
    expect(plan).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(expect.any(Object), { confirmed: true, confirmedMaxCost: 1 }, expect.objectContaining({
      operationId: 'planned_billable_op',
    }))
    expect(execute).not.toHaveBeenCalled()
  })
})
