import { queryFalStatus } from '@/lib/ai-providers/fal/queue'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import { createImageCandidateInvocationKey } from '@/lib/task/provider-invocation-identity'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'
import {
  assertHistoricalThrows,
  assertHistoricalValue,
  proveSemanticFaultRejected,
  type HistoricalRegressionScenario,
} from '../../harness/historical-regression'

type ProviderAssertion = (result: Awaited<ReturnType<typeof queryFalStatus>>) => void

async function withFalScenario(
  definitions: Parameters<Awaited<ReturnType<typeof startScenarioServer>>['defineScenario']>[0][],
  action: () => Promise<void>,
): Promise<void> {
  const server = await startScenarioServer()
  process.env.FAL_QUEUE_BASE_URL = `${server.baseUrl}/fal`
  try {
    for (const definition of definitions) server.defineScenario(definition)
    await action()
  } finally {
    delete process.env.FAL_QUEUE_BASE_URL
    await server.close()
  }
}

function falResultScenario(input: {
  readonly id: string
  readonly requestId: string
  readonly definitions: Parameters<Awaited<ReturnType<typeof startScenarioServer>>['defineScenario']>[0][]
  readonly assertResult: ProviderAssertion
  readonly faultyResult: Awaited<ReturnType<typeof queryFalStatus>>
}): HistoricalRegressionScenario {
  return {
    id: input.id, identity: input.id, defectId: 'BUG-PG-001', severity: 'P0',
    invariantIds: ['PG-01', 'PG-04'], historicalDefectIds: ['BUG-PG-001'],
    layers: ['integration-provider', 'regression'],
    async execute(context) {
      await withFalScenario(input.definitions, async () => {
        input.assertResult(await queryFalStatus('fal-ai/model/path', input.requestId, 'fal-key'))
      })
      context.recordExecution(input.id)
    },
    async verifyFailBefore() {
      await proveSemanticFaultRejected(() => input.assertResult(input.faultyResult))
    },
  }
}

const failed = falResultScenario({
  id: 'SCENARIO-PROVIDER-FAILED-TERMINAL', requestId: 'req-failed',
  definitions: [{
    method: 'GET', path: '/fal/fal-ai/model/requests/req-failed/status', mode: 'fatal_error',
    submitResponse: { status: 200, body: { status: 'FAILED', error: 'provider rejected request' } },
  }],
  assertResult(result) {
    assertHistoricalValue(result, {
      status: 'FAILED', completed: false, failed: true, error: 'provider rejected request',
    }, 'FAILED is terminal')
  },
  faultyResult: { status: 'IN_PROGRESS', completed: false, failed: false },
})

const completedWithoutMedia = falResultScenario({
  id: 'SCENARIO-PROVIDER-COMPLETED-WITHOUT-MEDIA', requestId: 'req-empty',
  definitions: [
    {
      method: 'GET', path: '/fal/fal-ai/model/requests/req-empty/status', mode: 'fatal_error',
      submitResponse: { status: 200, body: { status: 'COMPLETED' } },
    },
    {
      method: 'GET', path: '/fal/fal-ai/model/path/requests/req-empty', mode: 'success',
      submitResponse: { status: 200, body: { images: [] } },
    },
  ],
  assertResult(result) {
    assertHistoricalValue(result.failed, true, 'completed without media fails')
    assertHistoricalValue(result.resultUrl, undefined, 'completed without media has no result')
  },
  faultyResult: { status: 'COMPLETED', completed: true, failed: false },
})

const unknownStatus: HistoricalRegressionScenario = {
  id: 'SCENARIO-PROVIDER-UNKNOWN-STATUS', identity: 'SCENARIO-PROVIDER-UNKNOWN-STATUS',
  defectId: 'BUG-PG-001', severity: 'P0', invariantIds: ['PG-01'],
  historicalDefectIds: ['BUG-PG-001'], layers: ['integration-provider', 'regression'],
  async execute(context) {
    await withFalScenario([{
      method: 'GET', path: '/fal/fal-ai/model/requests/req-unknown/status', mode: 'fatal_error',
      submitResponse: { status: 200, body: { status: 'MYSTERY' } },
    }], async () => {
      await assertHistoricalThrows(
        () => queryFalStatus('fal-ai/model/path', 'req-unknown', 'fal-key'),
        'FAL_STATUS_UNKNOWN:MYSTERY',
        'unknown provider status fails explicitly',
      )
    })
    context.recordExecution(this.id)
  },
  async verifyFailBefore() {
    await proveSemanticFaultRejected(() => assertHistoricalThrows(
      async () => ({ status: 'IN_PROGRESS' }),
      'FAL_STATUS_UNKNOWN',
      'unknown provider status fails explicitly',
    ))
  },
}

const zeroFallback: HistoricalRegressionScenario = {
  id: 'SCENARIO-PROVIDER-ZERO-FALLBACK', identity: 'SCENARIO-PROVIDER-ZERO-FALLBACK',
  defectId: 'BUG-PG-001', severity: 'P0', invariantIds: ['PG-05'],
  historicalDefectIds: ['BUG-PG-001'], layers: ['regression'],
  async execute(context) {
    await assertHistoricalThrows(
      () => resolveAiProviderAdapter('missing-provider'),
      'AI_REGISTRY_PROVIDER_UNSUPPORTED:missing-provider',
      'unknown provider cannot fall back',
    )
    context.recordExecution(this.id)
  },
  async verifyFailBefore() {
    await proveSemanticFaultRejected(() => assertHistoricalThrows(
      () => ({ providerId: 'fallback-provider' }),
      'AI_PROVIDER_UNKNOWN',
      'unknown provider cannot fall back',
    ))
  },
}

const multiCandidateIdentity: HistoricalRegressionScenario = {
  id: 'SCENARIO-PROVIDER-MULTI-CANDIDATE-IDENTITY',
  identity: 'SCENARIO-PROVIDER-MULTI-CANDIDATE-IDENTITY',
  defectId: 'BUG-PG-002',
  severity: 'P1',
  invariantIds: ['PG-06', 'TL-13'],
  historicalDefectIds: ['BUG-PG-002'],
  layers: ['regression'],
  async execute(context) {
    assertHistoricalValue([
      createImageCandidateInvocationKey(0),
      createImageCandidateInvocationKey(1),
      createImageCandidateInvocationKey(2),
    ], [
      'media:image:candidate:0',
      'media:image:candidate:1',
      'media:image:candidate:2',
    ], 'every candidate receives an independent durable provider identity')
    context.recordExecution(this.id)
  },
  async verifyFailBefore() {
    await proveSemanticFaultRejected(() => {
      assertHistoricalValue([
        'media:image:primary',
        'media:image:primary',
        'media:image:primary',
      ], [
        'media:image:candidate:0',
        'media:image:candidate:1',
        'media:image:candidate:2',
      ], 'every candidate receives an independent durable provider identity')
    })
  },
}

export const PROVIDER_HISTORICAL_SCENARIOS: readonly HistoricalRegressionScenario[] = [
  failed,
  unknownStatus,
  completedWithoutMedia,
  zeroFallback,
  multiCandidateIdentity,
]
