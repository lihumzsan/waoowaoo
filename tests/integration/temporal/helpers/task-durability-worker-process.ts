import {
  spawn,
  type ChildProcess,
} from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { buildTestTaskQueue } from './versioned-worker'

const READY_MARKER = '[task-durability-worker] READY'
const BLOCKED_MARKER =
  '[task-durability-worker] RUN_RESULT_DURABLY_LOADED_AND_BLOCKED'

export interface TaskDurabilityChildWorker {
  readonly taskQueue: string
  waitUntilReady(): Promise<void>
  waitUntilRunResultBlocked(): Promise<void>
  killProcessGroup(): Promise<void>
  close(): Promise<void>
}

function isMissingProcess(error: unknown): boolean {
  return (
    error instanceof Error
    && 'code' in error
    && error.code === 'ESRCH'
  )
}

function signalProcessGroup(
  child: ChildProcess,
  signal: 'SIGTERM' | 'SIGKILL',
): void {
  const pid = child.pid
  if (!pid) throw new Error('TASK_DURABILITY_CHILD_PID_MISSING')
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (!isMissingProcess(error)) throw error
  }
}

async function within<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs)
        timer.unref()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function startTaskDurabilityChildWorker(): TaskDurabilityChildWorker {
  const configuredTaskQueue = process.env.TEMPORAL_TASK_QUEUE?.trim()
  if (!configuredTaskQueue) {
    throw new Error('TASK_DURABILITY_CHILD_TASK_QUEUE_REQUIRED')
  }
  const taskQueue = buildTestTaskQueue(
    configuredTaskQueue,
    'task-durability',
  )
  const child = spawn(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      resolve(
        process.cwd(),
        'tests/integration/temporal/helpers/task-durability-worker-child.ts',
      ),
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const logs: string[] = []
  const exit = once(child, 'exit')
  const append = (value: Buffer): void => {
    logs.push(
      ...value
        .toString('utf8')
        .split(/\r?\n/)
        .filter(Boolean),
    )
    if (logs.length > 400) logs.splice(0, logs.length - 400)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  let closed = false

  const waitForMarker = async (
    marker: string,
    timeoutCode: string,
  ): Promise<void> => {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (logs.some((line) => line.includes(marker))) return
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `TASK_DURABILITY_CHILD_EXITED:${marker}:${logs.join('\n')}`,
        )
      }
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, 20)
        timer.unref()
      })
    }
    throw new Error(`${timeoutCode}:${logs.join('\n')}`)
  }

  const kill = async (
    signal: 'SIGTERM' | 'SIGKILL',
  ): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return
    signalProcessGroup(child, signal)
    await within(
      exit.then(() => undefined),
      10_000,
      `TASK_DURABILITY_CHILD_${signal}_TIMEOUT`,
    )
  }

  return {
    taskQueue,
    async waitUntilReady() {
      await waitForMarker(READY_MARKER, 'TASK_DURABILITY_CHILD_READY_TIMEOUT')
    },
    async waitUntilRunResultBlocked() {
      await waitForMarker(
        BLOCKED_MARKER,
        'TASK_DURABILITY_CHILD_BLOCK_TIMEOUT',
      )
    },
    async killProcessGroup() {
      await kill('SIGKILL')
    },
    async close() {
      if (closed) return
      closed = true
      if (child.exitCode !== null || child.signalCode !== null) return
      try {
        await kill('SIGTERM')
      } catch {
        await kill('SIGKILL')
      }
    },
  }
}
