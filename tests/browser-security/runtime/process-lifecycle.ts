import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000
const FORCED_SHUTDOWN_TIMEOUT_MS = 5_000
const SHUTDOWN_POLL_INTERVAL_MS = 100

export interface SecurityProcessIdentity {
  readonly pid: number
  readonly processGroupId: number | null
}

function isValidProcessId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 1
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

export function createSecurityProcessIdentity(pid: number): SecurityProcessIdentity {
  if (!isValidProcessId(pid)) {
    throw new Error(`SECURITY_PROCESS_ID_INVALID:${String(pid)}`)
  }
  return {
    pid,
    processGroupId: process.platform === 'win32' ? null : pid,
  }
}

export function parseSecurityProcessIdentity(
  value: unknown,
): SecurityProcessIdentity | null {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object') {
    throw new Error('SECURITY_PROCESS_IDENTITY_INVALID')
  }
  const candidate = value as {
    readonly pid?: unknown
    readonly processGroupId?: unknown
  }
  if (!isValidProcessId(candidate.pid)) {
    throw new Error('SECURITY_PROCESS_IDENTITY_PID_INVALID')
  }
  if (
    candidate.processGroupId !== null
    && !isValidProcessId(candidate.processGroupId)
  ) {
    throw new Error('SECURITY_PROCESS_IDENTITY_GROUP_INVALID')
  }
  return {
    pid: candidate.pid,
    processGroupId: candidate.processGroupId,
  }
}

export function isSecurityProcessTreeAlive(
  identity: SecurityProcessIdentity,
): boolean {
  const target = process.platform === 'win32'
    ? identity.pid
    : -(identity.processGroupId ?? identity.pid)
  try {
    process.kill(target, 0)
    return true
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false
    if (errorCode(error) === 'EPERM') return true
    throw error
  }
}

function signalPosixProcessGroup(
  identity: SecurityProcessIdentity,
  signal: NodeJS.Signals,
): void {
  const processGroupId = identity.processGroupId ?? identity.pid
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error
  }
}

function terminateWindowsProcessTree(identity: SecurityProcessIdentity, force: boolean): void {
  if (!isSecurityProcessTreeAlive(identity)) return
  try {
    execFileSync(
      'taskkill',
      ['/PID', String(identity.pid), '/T', ...(force ? ['/F'] : [])],
      { stdio: 'ignore' },
    )
  } catch (error) {
    if (isSecurityProcessTreeAlive(identity)) throw error
  }
}

async function waitForProcessTreeExit(
  identity: SecurityProcessIdentity,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isSecurityProcessTreeAlive(identity)) return true
    await delay(SHUTDOWN_POLL_INTERVAL_MS)
  }
  return !isSecurityProcessTreeAlive(identity)
}

export async function terminateSecurityProcessTree(
  identity: SecurityProcessIdentity,
): Promise<void> {
  if (!isSecurityProcessTreeAlive(identity)) return
  if (process.platform === 'win32') terminateWindowsProcessTree(identity, false)
  else signalPosixProcessGroup(identity, 'SIGTERM')
  if (await waitForProcessTreeExit(identity, GRACEFUL_SHUTDOWN_TIMEOUT_MS)) return

  if (process.platform === 'win32') terminateWindowsProcessTree(identity, true)
  else signalPosixProcessGroup(identity, 'SIGKILL')
  if (await waitForProcessTreeExit(identity, FORCED_SHUTDOWN_TIMEOUT_MS)) return

  throw new Error(
    `SECURITY_PROCESS_TREE_SHUTDOWN_TIMEOUT:${String(identity.pid)}:${String(identity.processGroupId)}`,
  )
}
