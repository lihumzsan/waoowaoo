import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { NativeConnection, Worker } from '@temporalio/worker'
import type { AgentTurnAdmissionReceipt } from '@/lib/agent-turn/contracts'
import {
  admitAgentTurn,
  cancelAgentTurn,
  resolveAgentTurnApproval,
} from '@/lib/temporal/activities/agent-thread'
import type { AdmitAgentTurnActivityInput } from '@/lib/temporal/agent-thread/contracts'
import {
  buildTemporalConnectionOptions,
  getTemporalRuntimeConfig,
} from '@/lib/temporal/config'

export interface AgentAdmissionWorkerHarness {
  readonly taskQueue: string
  waitForPostCommitFault(): Promise<void>
  close(): Promise<void>
}

function requireTemporalTestRuntime(): void {
  if (
    process.env.NODE_ENV !== 'test'
    || process.env.TEMPORAL_TEST_BOOTSTRAP !== '1'
  ) {
    throw new Error('AGENT_TEMPORAL_TEST_RUNTIME_REQUIRED')
  }
  const namespace = process.env.TEMPORAL_NAMESPACE?.trim()
  const address = process.env.TEMPORAL_ADDRESS?.trim()
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (
    !namespace
    || !namespace.includes('test')
    || !address
    || !databaseUrl
    || new URL(databaseUrl).pathname.replace(/^\//, '') !== 'waoowaoo_test'
  ) {
    throw new Error('AGENT_TEMPORAL_TEST_RUNTIME_UNSAFE')
  }
}

export async function startAgentAdmissionWorker(): Promise<AgentAdmissionWorkerHarness> {
  requireTemporalTestRuntime()
  const config = getTemporalRuntimeConfig()
  const taskQueue = [
    config.taskQueue,
    'agent-admission',
    randomUUID().replaceAll('-', '').slice(0, 12),
  ].join('-')
  const connection = await NativeConnection.connect(
    buildTemporalConnectionOptions(config),
  )
  let shouldDropPostCommitAcknowledgement = true
  let markFaultInjected: (() => void) | null = null
  const postCommitFault = new Promise<void>((resolveFault) => {
    markFaultInjected = resolveFault
  })

  const admitWithOnePostCommitFault = async (
    input: AdmitAgentTurnActivityInput,
  ): Promise<AgentTurnAdmissionReceipt> => {
    const receipt = await admitAgentTurn(input)
    if (shouldDropPostCommitAcknowledgement) {
      shouldDropPostCommitAcknowledgement = false
      markFaultInjected?.()
      throw new Error('TEST_AGENT_ADMISSION_ACK_LOST_AFTER_COMMIT')
    }
    return receipt
  }

  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue,
    workflowsPath: resolve(
      process.cwd(),
      'src/lib/temporal/workflows/index.ts',
    ),
    activities: {
      admitAgentTurn: admitWithOnePostCommitFault,
      resolveAgentTurnApproval,
      cancelAgentTurn,
    },
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  let closed = false

  return {
    taskQueue,
    async waitForPostCommitFault() {
      await postCommitFault
    },
    async close() {
      if (closed) return
      closed = true
      worker.shutdown()
      try {
        await run
      } finally {
        await connection.close()
      }
    },
  }
}
