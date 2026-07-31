import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Context, heartbeat } from '@temporalio/activity'
import { NativeConnection, Worker } from '@temporalio/worker'
import type {
  AgentTurnAdmissionReceipt,
  AgentTurnExecutionResult,
} from '@/lib/agent-turn/contracts'
import { claimAgentTurnExecution } from '@/lib/agent-turn/service'
import {
  admitAgentTurn,
  cancelAgentTurn,
  recoverAgentThread,
  resolveAgentTurnApproval,
  settleLostAgentTurn,
} from '@/lib/temporal/activities/agent-thread'
import type {
  AdmitAgentTurnActivityInput,
  ExecuteAgentTurnActivityInput,
} from '@/lib/temporal/agent-thread/contracts'
import { buildTemporalConnectionOptions, getTemporalRuntimeConfig } from '@/lib/temporal/config'

export interface AgentAdmissionWorkerHarness {
  readonly taskQueue: string
  waitForPostCommitFault(): Promise<void>
  close(): Promise<void>
}

export interface AgentSupersedeWorkerHarness {
  readonly taskQueue: string
  waitForEvent(event: string): Promise<void>
  readEvents(): readonly string[]
  close(): Promise<void>
}

function requireTemporalTestRuntime(): void {
  if (process.env.NODE_ENV !== 'test' || process.env.TEMPORAL_TEST_BOOTSTRAP !== '1') {
    throw new Error('AGENT_TEMPORAL_TEST_RUNTIME_REQUIRED')
  }
  const namespace = process.env.TEMPORAL_NAMESPACE?.trim()
  const address = process.env.TEMPORAL_ADDRESS?.trim()
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (
    !namespace ||
    !namespace.includes('test') ||
    !address ||
    !databaseUrl ||
    new URL(databaseUrl).pathname.replace(/^\//, '') !== 'waoowaoo_test'
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
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions(config))
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
    workflowsPath: resolve(process.cwd(), 'src/lib/temporal/workflows/index.ts'),
    activities: {
      admitAgentTurn: admitWithOnePostCommitFault,
      recoverAgentThread,
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

export async function startAgentSupersedeWorker(): Promise<AgentSupersedeWorkerHarness> {
  requireTemporalTestRuntime()
  const config = getTemporalRuntimeConfig()
  const taskQueue = [
    config.taskQueue,
    'agent-supersede',
    randomUUID().replaceAll('-', '').slice(0, 12),
  ].join('-')
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions(config))
  const events: string[] = []
  const waiters = new Map<string, Set<() => void>>()
  const recordEvent = (event: string): void => {
    events.push(event)
    for (const resolveEvent of waiters.get(event) ?? []) resolveEvent()
    waiters.delete(event)
  }
  const executeUntilCancelled = async (
    input: ExecuteAgentTurnActivityInput,
  ): Promise<AgentTurnExecutionResult> => {
    await claimAgentTurnExecution({
      turnId: input.turnId,
      executionOwnerId: input.executionOwnerId,
    })
    const signal = Context.current().cancellationSignal
    const pulse = (): void => {
      heartbeat({
        protocol: 'agent_turn_supersede_test_v1',
        turnId: input.turnId,
        executionOwnerId: input.executionOwnerId,
      })
    }
    pulse()
    const timer = setInterval(pulse, 1_000)
    timer.unref()
    recordEvent(`started:${input.turnId}`)
    try {
      if (!signal.aborted) {
        await new Promise<void>((resolveCancelled) => {
          signal.addEventListener('abort', () => resolveCancelled(), { once: true })
        })
      }
      clearInterval(timer)
      // Keep the Activity open briefly after Temporal has delivered
      // cancellation so the integration scenario can admit two rapid
      // corrections before the old execution has drained.
      await new Promise<void>((resolveDrain) => setTimeout(resolveDrain, 150))
      recordEvent(`cancelled:${input.turnId}`)
      signal.throwIfAborted()
      throw new Error('AGENT_SUPERSEDE_TEST_CANCELLATION_NOT_PROPAGATED')
    } finally {
      clearInterval(timer)
    }
  }
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue,
    workflowsPath: resolve(process.cwd(), 'src/lib/temporal/workflows/index.ts'),
    activities: {
      admitAgentTurn,
      recoverAgentThread,
      executeAgentTurn: executeUntilCancelled,
      settleLostAgentTurn,
      cancelAgentTurn,
    },
    maxHeartbeatThrottleInterval: '1 second',
    defaultHeartbeatThrottleInterval: '1 second',
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  let closed = false
  return {
    taskQueue,
    async waitForEvent(event) {
      if (events.includes(event)) return
      await new Promise<void>((resolveEvent) => {
        const current = waiters.get(event) ?? new Set<() => void>()
        current.add(resolveEvent)
        waiters.set(event, current)
      })
    },
    readEvents() {
      return [...events]
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
