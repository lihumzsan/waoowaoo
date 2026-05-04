import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CODEX_DEFAULT_EXECUTABLE_PATH,
  CODEX_DEFAULT_MODEL_ID,
} from './constants'

export type CodexChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface CodexCompletionParams {
  codexPath?: string
  model?: string
  messages: CodexChatMessage[]
  imagePaths?: string[]
  cwd?: string
  timeoutMs?: number
}

export interface CodexCompletionResult {
  text: string
  stdout: string
  stderr: string
}

export interface CodexSelfCheckResult extends CodexCompletionResult {
  durationMs: number
}

export class CodexExecError extends Error {
  code: string
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  stdout?: string
  stderr?: string

  constructor(
    code: string,
    message: string,
    details?: {
      exitCode?: number | null
      signal?: NodeJS.Signals | null
      stdout?: string
      stderr?: string
    },
  ) {
    super(`${code}: ${message}`)
    this.name = 'CodexExecError'
    this.code = code
    this.exitCode = details?.exitCode
    this.signal = details?.signal
    this.stdout = details?.stdout
    this.stderr = details?.stderr
  }
}

type SpawnResult = {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

const DEFAULT_CODEX_EXEC_TIMEOUT_MS = 20 * 60 * 1000
const CODEX_FORCE_KILL_GRACE_MS = 5000
const OUTPUT_TRUNCATE_LIMIT = 4000

function readTimeoutMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_CODEX_EXEC_TIMEOUT_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CODEX_EXEC_TIMEOUT_MS
  return Math.max(parsed, DEFAULT_CODEX_EXEC_TIMEOUT_MS)
}

function truncateForError(value: string): string {
  if (value.length <= OUTPUT_TRUNCATE_LIMIT) return value
  return `${value.slice(0, OUTPUT_TRUNCATE_LIMIT)}... [truncated]`
}

function expandWindowsEnv(input: string): string {
  return input.replace(/%([^%]+)%/g, (match, name: string) => {
    const value = process.env[name]
    return value && value.length > 0 ? value : match
  })
}

export function resolveCodexExecutablePath(rawPath?: string): string {
  const configuredPath = (rawPath || CODEX_DEFAULT_EXECUTABLE_PATH).trim()
  const withEnv = expandWindowsEnv(configuredPath)
  if (withEnv === '~') return os.homedir()
  if (withEnv.startsWith('~/') || withEnv.startsWith('~\\')) {
    return path.join(os.homedir(), withEnv.slice(2))
  }
  return withEnv
}

export function buildCodexPrompt(messages: CodexChatMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role.toUpperCase()
      return `${role}:\n${message.content}`
    })
    .join('\n\n')
}

export function buildCodexExecArgs(params: {
  model?: string
  outputPath: string
  prompt: string
  imagePaths?: string[]
}): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--json',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--disable',
    'plugins',
    '--disable',
    'memories',
    '--disable',
    'apps',
    '--disable',
    'shell_snapshot',
    '-m',
    params.model || CODEX_DEFAULT_MODEL_ID,
    '--output-last-message',
    params.outputPath,
  ]

  for (const imagePath of params.imagePaths || []) {
    args.push('-i', imagePath)
  }

  args.push(params.prompt)
  return args
}

async function assertCodexExecutableExists(executablePath: string): Promise<void> {
  try {
    await fs.access(executablePath)
  } catch {
    throw new CodexExecError(
      'CODEX_EXECUTABLE_NOT_FOUND',
      `Codex executable was not found at ${executablePath}`,
    )
  }
}

function spawnCodex(
  executablePath: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(executablePath, args, {
        cwd: options.cwd || process.cwd(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer: NodeJS.Timeout
    let killTimer: NodeJS.Timeout | null = null
    let forceRejectTimer: NodeJS.Timeout | null = null

    const buildTimeoutError = (exitCode?: number | null, signal?: NodeJS.Signals | null) =>
      new CodexExecError(
        'CODEX_EXEC_TIMEOUT',
        `Codex exec timed out after ${Math.round(options.timeoutMs / 1000)}s`,
        {
          exitCode,
          signal,
          stdout: truncateForError(stdout),
          stderr: truncateForError(stderr),
        },
      )

    const clearTimers = () => {
      clearTimeout(timer)
      if (killTimer) {
        clearTimeout(killTimer)
        killTimer = null
      }
      if (forceRejectTimer) {
        clearTimeout(forceRejectTimer)
        forceRejectTimer = null
      }
    }

    const rejectOnce = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimers()
      reject(error)
    }

    const resolveOnce = (result: SpawnResult) => {
      if (settled) return
      settled = true
      clearTimers()
      resolve(result)
    }

    const requestTermination = () => {
      try {
        child.kill('SIGTERM')
      } catch {
        // Ignore termination errors; timeout rejection below is the user-visible failure.
      }

      if (process.platform === 'win32' && child.pid) {
        try {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          })
          killer.once('error', () => undefined)
        } catch {
          // child.kill above is still attempted; do not mask the timeout.
        }
      }

      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Ignore; forceRejectTimer guarantees the caller is released.
        }
      }, CODEX_FORCE_KILL_GRACE_MS)
      if (typeof killTimer.unref === 'function') killTimer.unref()
    }

    timer = setTimeout(() => {
      timedOut = true
      requestTermination()
      forceRejectTimer = setTimeout(
        () => rejectOnce(buildTimeoutError(null, null)),
        CODEX_FORCE_KILL_GRACE_MS + 1000,
      )
      if (typeof forceRejectTimer.unref === 'function') forceRejectTimer.unref()
    }, options.timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      if (timedOut) {
        rejectOnce(buildTimeoutError(null, null))
        return
      }
      rejectOnce(error)
    })
    child.once('close', (exitCode, signal) => {
      if (timedOut) {
        rejectOnce(buildTimeoutError(exitCode, signal))
        return
      }
      resolveOnce({ exitCode, signal, stdout, stderr })
    })
  })
}

export async function runCodexTextCompletion(
  params: CodexCompletionParams,
): Promise<CodexCompletionResult> {
  const executablePath = resolveCodexExecutablePath(params.codexPath)
  await assertCodexExecutableExists(executablePath)

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-codex-'))
  const outputPath = path.join(tempDir, 'last-message.txt')
  const prompt = buildCodexPrompt(params.messages)
  const args = buildCodexExecArgs({
    model: params.model,
    outputPath,
    prompt,
    imagePaths: params.imagePaths,
  })
  const timeoutMs = params.timeoutMs ?? readTimeoutMs(process.env.CODEX_LLM_TIMEOUT_MS)

  try {
    const result = await spawnCodex(executablePath, args, {
      cwd: params.cwd,
      timeoutMs,
    }).catch((error) => {
      if (error instanceof CodexExecError) throw error
      throw new CodexExecError(
        'CODEX_EXEC_FAILED',
        error instanceof Error ? error.message : String(error),
      )
    })

    if (result.exitCode !== 0) {
      throw new CodexExecError(
        'CODEX_EXEC_FAILED',
        `Codex exec exited with code ${result.exitCode ?? 'null'}`,
        {
          exitCode: result.exitCode,
          signal: result.signal,
          stdout: truncateForError(result.stdout),
          stderr: truncateForError(result.stderr),
        },
      )
    }

    const output = await fs.readFile(outputPath, 'utf8').catch(() => '')
    const text = output.trimEnd()
    if (!text.trim()) {
      throw new CodexExecError(
        'CODEX_EMPTY_OUTPUT',
        'Codex exec completed without writing a final message',
        {
          exitCode: result.exitCode,
          signal: result.signal,
          stdout: truncateForError(result.stdout),
          stderr: truncateForError(result.stderr),
        },
      )
    }

    return {
      text,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function runCodexSelfCheck(params: {
  codexPath?: string
  model?: string
  cwd?: string
  timeoutMs?: number
} = {}): Promise<CodexSelfCheckResult> {
  const startedAt = Date.now()
  const result = await runCodexTextCompletion({
    codexPath: params.codexPath,
    model: params.model || CODEX_DEFAULT_MODEL_ID,
    cwd: params.cwd,
    timeoutMs: params.timeoutMs,
    messages: [{
      role: 'user',
      content: 'Reply with exactly CODEX_OK and no other text.',
    }],
  })

  if (!result.text.trim().includes('CODEX_OK')) {
    throw new CodexExecError(
      'CODEX_EXEC_FAILED',
      `Codex self-check returned unexpected text: ${truncateForError(result.text.trim())}`,
      {
        stdout: truncateForError(result.stdout),
        stderr: truncateForError(result.stderr),
      },
    )
  }

  return {
    ...result,
    durationMs: Date.now() - startedAt,
  }
}

function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    default:
      return '.img'
  }
}

async function writeDataUrlImage(dataUrl: string, tempDir: string): Promise<string | null> {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(dataUrl)
  if (!match) return null
  const mimeType = match[1] || 'application/octet-stream'
  const payload = match[2] || ''
  const filePath = path.join(tempDir, `${randomUUID()}${extensionForMime(mimeType)}`)
  await fs.writeFile(filePath, Buffer.from(payload, 'base64'))
  return filePath
}

async function maybeExistingLocalPath(input: string): Promise<string | null> {
  let candidate = input
  if (input.startsWith('file:')) {
    try {
      candidate = fileURLToPath(input)
    } catch {
      return null
    }
  }
  if (!path.isAbsolute(candidate)) return null
  try {
    await fs.access(candidate)
    return candidate
  } catch {
    return null
  }
}

export async function prepareCodexImageInputs(
  inputs: string[],
  normalizer: (input: string) => Promise<string>,
): Promise<{ imagePaths: string[]; cleanup: () => Promise<void> }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-codex-images-'))
  const imagePaths: string[] = []

  try {
    for (const rawInput of inputs) {
      const input = rawInput.trim()
      if (!input) continue

      const directDataUrl = input.startsWith('data:')
        ? await writeDataUrlImage(input, tempDir)
        : null
      if (directDataUrl) {
        imagePaths.push(directDataUrl)
        continue
      }

      const localPath = await maybeExistingLocalPath(input)
      if (localPath) {
        imagePaths.push(localPath)
        continue
      }

      const normalized = await normalizer(input)
      const normalizedLocalPath = await maybeExistingLocalPath(normalized)
      if (normalizedLocalPath) {
        imagePaths.push(normalizedLocalPath)
        continue
      }

      const normalizedDataUrl = await writeDataUrlImage(normalized, tempDir)
      if (normalizedDataUrl) {
        imagePaths.push(normalizedDataUrl)
      }
    }

    return {
      imagePaths,
      cleanup: () => fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined),
    }
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}
