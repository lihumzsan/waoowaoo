import { resolve } from 'node:path'
import { heartbeat } from '@temporalio/activity'
import { NativeConnection, Worker } from '@temporalio/worker'
import { claimAgentTurnExecution } from '@/lib/agent-turn/service'
import { admitAgentTurn } from '@/lib/temporal/activities/agent-thread'
import type { ExecuteAgentTurnActivityInput } from '@/lib/temporal/agent-thread/contracts'
import {
  buildTemporalConnectionOptions,
  getTemporalRuntimeConfig,
} from '@/lib/temporal/config'

const configuredTaskQueue = process.env.AGENT_KILL_TASK_QUEUE?.trim()
if (
  process.env.NODE_ENV !== 'test'
  || process.env.TEMPORAL_TEST_BOOTSTRAP !== '1'
  || process.env.AGENT_KILL_WORKER !== '1'
  || !configuredTaskQueue
) {
  throw new Error('AGENT_KILL_WORKER_RUNTIME_INVALID')
}
const taskQueue: string = configuredTaskQueue

async function executeAgentTurnUntilKilled(
  input: ExecuteAgentTurnActivityInput,
): Promise<never> {
  await claimAgentTurnExecution({
    turnId: input.turnId,
    executionOwnerId: input.executionOwnerId,
  })
  const pulse = (): void => {
    heartbeat({
      protocol: 'agent_turn_worker_loss_test_v1',
      turnId: input.turnId,
      executionOwnerId: input.executionOwnerId,
    })
  }
  pulse()
  const timer = setInterval(pulse, 10_000)
  timer.unref()
  process.stdout.write(`[agent-kill-worker] running:${input.turnId}\n`)
  return await new Promise<never>(() => undefined)
}

async function main(): Promise<void> {
  const config = getTemporalRuntimeConfig()
  const connection = await NativeConnection.connect(
    buildTemporalConnectionOptions(config),
  )
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue,
    workflowsPath: resolve(
      process.cwd(),
      'src/lib/temporal/workflows/index.ts',
    ),
    activities: {
      admitAgentTurn,
      executeAgentTurn: executeAgentTurnUntilKilled,
    },
    shutdownGraceTime: '5 seconds',
  })

  process.stdout.write(`[agent-kill-worker] ready:${taskQueue}\n`)
  try {
    await worker.run()
  } finally {
    await connection.close()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `[agent-kill-worker] fatal:${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }\n`,
  )
  process.exitCode = 1
})
