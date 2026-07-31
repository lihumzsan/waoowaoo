import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { NativeConnection, Worker } from '@temporalio/worker'
import { settleLostAgentTurn } from '@/lib/temporal/activities/agent-thread'
import {
  buildTemporalConnectionOptions,
  getTemporalRuntimeConfig,
} from '@/lib/temporal/config'

interface ChildExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

export interface KillableAgentWorker {
  readonly taskQueue: string
  waitUntilReady(): Promise<void>
  waitUntilTurnRunning(turnId: string): Promise<void>
  killProcessGroup(): Promise<void>
  close(): Promise<void>
}

export interface AgentSettlementWorker {
  close(): Promise<void>
}

function requireSafeRuntime(): void {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (
    process.env.NODE_ENV !== 'test'
    || process.env.TEMPORAL_TEST_BOOTSTRAP !== '1'
    || !process.env.TEMPORAL_NAMESPACE?.includes('test')
    || !databaseUrl
    || new URL(databaseUrl).pathname.replace(/^\//, '') !== 'waoowaoo_test'
    || process.platform === 'win32'
  ) {
    throw new Error('AGENT_WORKER_LOSS_TEST_RUNTIME_UNSAFE')
  }
}

function childExit(child: ChildProcess): Promise<ChildExit> {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', (code, signal) => {
      resolveExit({ code, signal })
    })
  })
}

async function waitForOutput(params: {
  marker: string
  readOutput: () => string
  exited: Promise<ChildExit>
  timeoutMs: number
}): Promise<void> {
  const deadline = Date.now() + params.timeoutMs
  while (Date.now() < deadline) {
    if (params.readOutput().includes(params.marker)) return
    const outcome = await Promise.race([
      params.exited.then((exit) => ({ kind: 'exit' as const, exit })),
      new Promise<{ kind: 'tick' }>((resolveTick) => {
        setTimeout(() => resolveTick({ kind: 'tick' }), 25)
      }),
    ])
    if (outcome.kind === 'exit') {
      throw new Error(
        `AGENT_KILL_WORKER_EXITED_BEFORE_MARKER:${params.marker}:`
        + `${String(outcome.exit.code)}:${outcome.exit.signal ?? 'none'}:`
        + params.readOutput().slice(-4_000),
      )
    }
  }
  throw new Error(
    `AGENT_KILL_WORKER_MARKER_TIMEOUT:${params.marker}:`
    + params.readOutput().slice(-4_000),
  )
}

export async function startKillableAgentWorker(): Promise<KillableAgentWorker> {
  requireSafeRuntime()
  const config = getTemporalRuntimeConfig()
  const taskQueue = [
    config.taskQueue,
    'agent-worker-loss',
    randomUUID().replaceAll('-', '').slice(0, 12),
  ].join('-')
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve(
        process.cwd(),
        'tests/integration/temporal/helpers/agent-kill-worker.ts',
      ),
    ],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        AGENT_KILL_WORKER: '1',
        AGENT_KILL_TASK_QUEUE: taskQueue,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (!child.pid || !child.stdout || !child.stderr) {
    throw new Error('AGENT_KILL_WORKER_PROCESS_INVALID')
  }
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    output = `${output}${chunk}`.slice(-16_000)
  })
  child.stderr.on('data', (chunk: string) => {
    output = `${output}${chunk}`.slice(-16_000)
  })
  const exited = childExit(child)
  const processGroupId = child.pid
  let killed = false

  const killProcessGroup = async (): Promise<void> => {
    if (killed) return
    killed = true
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      process.kill(-processGroupId, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    const result = await exited
    if (result.signal !== 'SIGKILL') {
      throw new Error(
        `AGENT_KILL_WORKER_NOT_SIGKILL:${String(result.code)}:`
        + `${result.signal ?? 'none'}:${output.slice(-4_000)}`,
      )
    }
  }

  return {
    taskQueue,
    async waitUntilReady() {
      await waitForOutput({
        marker: `[agent-kill-worker] ready:${taskQueue}`,
        readOutput: () => output,
        exited,
        timeoutMs: 30_000,
      })
    },
    async waitUntilTurnRunning(turnId) {
      await waitForOutput({
        marker: `[agent-kill-worker] running:${turnId}`,
        readOutput: () => output,
        exited,
        timeoutMs: 30_000,
      })
    },
    killProcessGroup,
    async close() {
      await killProcessGroup()
    },
  }
}

export async function startAgentSettlementWorker(
  taskQueue: string,
): Promise<AgentSettlementWorker> {
  requireSafeRuntime()
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
    activities: { settleLostAgentTurn },
    shutdownGraceTime: '5 seconds',
  })
  const run = worker.run()
  let closed = false
  return {
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
