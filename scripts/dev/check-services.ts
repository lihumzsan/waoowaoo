import { existsSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Connection } from '@temporalio/client'
import {
  buildTemporalConnectionOptions,
  getTemporalWorkerRuntimeConfig,
} from '../../src/lib/temporal/config'

const execFileAsync = promisify(execFile)

async function belongsToWatcher(workerId: number, watcherId: number): Promise<boolean> {
  // tsx watch owns a child Node process. Verify the ready PID's ancestry before
  // trusting it, since a stale ready file can outlive a previous launch.
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command',
    `$currentId = ${workerId}; $seen = @{}; while ($currentId -gt 0 -and !$seen.ContainsKey($currentId)) { if ($currentId -eq ${watcherId}) { Write-Output 'owned'; break }; $seen[$currentId] = $true; $current = Get-CimInstance Win32_Process -Filter "ProcessId=$currentId"; if (!$current) { break }; $currentId = $current.ParentProcessId }`,
  ], { windowsHide: true, timeout: 15_000 })
  return stdout.trim() === 'owned'
}

async function checkTemporal(mode: 'preflight' | 'worker'): Promise<void> {
  const config = getTemporalWorkerRuntimeConfig()
  // Remote infrastructure needs a namespace as well as a queue: scheduler IDs
  // are scoped by namespace and can otherwise reuse another machine's Worker.
  const server = new URL(`http://${config.address}`).hostname
  if (!['localhost', '127.0.0.1', '[::1]'].includes(server)) {
    const localNamespace = `waoowaoo-local-${hostname().toLowerCase()}`
    if (config.namespace !== localNamespace || config.taskQueue !== `${localNamespace}-runtime`) {
      throw new Error(`Configure a dedicated Temporal namespace ${localNamespace} and queue ${localNamespace}-runtime in .env before starting against remote infrastructure.`)
    }
  }
  const connection = await Connection.connect(buildTemporalConnectionOptions(config))
  try {
    const description = await connection.withDeadline(Date.now() + 15_000, () =>
      connection.workflowService.describeNamespace({ namespace: config.namespace }),
    )
    if (description.namespaceInfo?.state !== 1) {
      throw new Error('The configured Temporal namespace must already be registered and active.')
    }
    if (mode === 'preflight') {
      console.log(`Temporal ready: namespace=${config.namespace}; queue=${config.taskQueue}`)
      return
    }

    const watcherId = Number(process.argv[3])
    if (!Number.isSafeInteger(watcherId) || watcherId <= 0 || !config.workerReadyFile) {
      throw new Error('Worker watcher PID and TEMPORAL_WORKER_READY_FILE are required.')
    }
    const deadline = Date.now() + 300_000
    while (Date.now() < deadline) {
      process.kill(watcherId, 0)
      const workerId = existsSync(config.workerReadyFile)
        ? Number(readFileSync(config.workerReadyFile, 'utf8').trim())
        : 0
      if (Number.isSafeInteger(workerId) && workerId > 0 && await belongsToWatcher(workerId, watcherId)) {
        const identity = `${workerId}@${hostname()}`
        const queues = await Promise.all([1, 2].map((taskQueueType) =>
          connection.withDeadline(Date.now() + 10_000, () =>
            connection.workflowService.describeTaskQueue({
              namespace: config.namespace,
              taskQueue: { name: config.taskQueue },
              taskQueueType,
            }),
          ),
        ))
        if (queues.every((queue) => queue.pollers?.some((poller) => poller.identity === identity))) {
          console.log(`Local Worker ready: ${identity}`)
          return
        }
      }
      await delay(1_000)
    }
    throw new Error('Local Worker did not become ready within 300 seconds.')
  } finally {
    await connection.close()
  }
}

async function checkWeb(): Promise<void> {
  // Warm the MCP route before the first Codex handshake. No project data or
  // credentials are needed; the protected endpoint must still reject access.
  for (const [path, expectedStatus] of [
    ['/api/auth/csrf', 200],
    ['/api/internal/codex-runtime/mcp', 401],
  ] as const) {
    const deadline = Date.now() + 240_000
    for (;;) {
      try {
        const response = await fetch(`http://127.0.0.1:3000${path}`, {
          signal: AbortSignal.timeout(180_000),
          redirect: 'manual',
        })
        await response.arrayBuffer()
        if (response.status !== expectedStatus) throw new Error(`${path}: unexpected HTTP ${response.status}`)
        console.log(`${path}: HTTP ${response.status}`)
        break
      } catch (error: unknown) {
        const cause = error instanceof Error ? error.cause : undefined
        if (!cause || typeof cause !== 'object' || !('code' in cause)
          || cause.code !== 'ECONNREFUSED' || Date.now() >= deadline) throw error
        await delay(1_000)
      }
    }
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2]
  if (mode === 'preflight' || mode === 'worker') return checkTemporal(mode)
  if (mode === 'web') return checkWeb()
  throw new Error('Expected preflight, worker or web readiness mode.')
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
