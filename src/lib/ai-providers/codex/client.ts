import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs, readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CODEX_DEFAULT_EXECUTABLE_PATH,
  CODEX_LEGACY_SANDBOX_EXECUTABLE_PATH,
  CODEX_DEFAULT_MODEL_ID,
  CODEX_DEFAULT_REASONING_EFFORT,
  CODEX_DEFAULT_SERVICE_TIER,
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

export interface CodexImageGenerationParams {
  codexPath?: string
  model?: string
  prompt: string
  imagePaths?: string[]
  cwd?: string
  timeoutMs?: number
}

export interface CodexImageGenerationResult {
  imagePath: string
  imageBase64: string
  mimeType: string
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
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const CODEX_RUNTIME_CONFIG_ARGS = [
  '--config',
  'approval_policy="never"',
  '--config',
  `model_reasoning_effort="${CODEX_DEFAULT_REASONING_EFFORT}"`,
  '--config',
  `service_tier="${CODEX_DEFAULT_SERVICE_TIER}"`,
]

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

function normalizePathForCompare(input: string): string {
  const resolved = path.resolve(input)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function samePath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right)
}

function isExistingFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile()
  } catch {
    return false
  }
}

function readCurrentCodexCliPath(): string | undefined {
  const configured = process.env.CODEX_CLI_PATH?.trim()
  if (!configured) return undefined
  return expandWindowsEnv(configured)
}

function listLocalCodexExecutableCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return []

  const binDir = path.join(localAppData, 'OpenAI', 'Codex', 'bin')
  const versionedCandidates: Array<{ filePath: string; mtimeMs: number }> = []
  try {
    for (const entry of readdirSync(binDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const filePath = path.join(binDir, entry.name, 'codex.exe')
      if (!isExistingFile(filePath)) continue
      versionedCandidates.push({ filePath, mtimeMs: statSync(filePath).mtimeMs })
    }
  } catch {
    // The desktop Codex install path is optional; keep probing other candidates.
  }

  versionedCandidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  return [
    ...versionedCandidates.map((candidate) => candidate.filePath),
    path.join(binDir, 'codex.exe'),
  ]
}

function firstExistingPath(paths: Array<string | undefined>): string | null {
  for (const candidate of paths) {
    if (!candidate) continue
    if (isExistingFile(candidate)) return candidate
  }
  return null
}

export function resolveCodexExecutablePath(rawPath?: string): string {
  const configuredPath = (rawPath || CODEX_DEFAULT_EXECUTABLE_PATH).trim()
  const withEnv = expandWindowsEnv(configuredPath)
  const autoPaths = [
    CODEX_DEFAULT_EXECUTABLE_PATH,
    CODEX_LEGACY_SANDBOX_EXECUTABLE_PATH,
  ].map(expandWindowsEnv)
  const shouldAutoResolve = !rawPath?.trim() || autoPaths.some((autoPath) => samePath(withEnv, autoPath))
  if (shouldAutoResolve) {
    const resolved = firstExistingPath([
      readCurrentCodexCliPath(),
      ...listLocalCodexExecutableCandidates(),
      withEnv,
      expandWindowsEnv(CODEX_LEGACY_SANDBOX_EXECUTABLE_PATH),
    ])
    if (resolved) return resolved
  }

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
  imagePaths?: string[]
}): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--json',
    ...CODEX_RUNTIME_CONFIG_ARGS,
    '--color',
    'never',
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

  args.push('-')
  return args
}

export function buildCodexImageExecArgs(params: {
  model?: string
  outputPath: string
  imagePaths?: string[]
}): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--json',
    ...CODEX_RUNTIME_CONFIG_ARGS,
    '--color',
    'never',
    '--enable',
    'image_generation',
    '--sandbox',
    'danger-full-access',
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

  args.push('-')
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
  options: { cwd?: string; timeoutMs: number; stdin?: string },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(executablePath, args, {
        cwd: options.cwd || process.cwd(),
        shell: false,
        windowsHide: true,
        stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
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

    const timer = setTimeout(() => {
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
    child.stdin?.once('error', () => undefined)
    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin, 'utf8')
    }
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
    imagePaths: params.imagePaths,
  })
  const timeoutMs = params.timeoutMs ?? readTimeoutMs(process.env.CODEX_LLM_TIMEOUT_MS)

  try {
    const result = await spawnCodex(executablePath, args, {
      cwd: params.cwd,
      timeoutMs,
      stdin: prompt,
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

function inferImageMimeType(buffer: Buffer, filePath: string): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'image/gif'
    }
  }

  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}

function collectStringValues(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output)
    return output
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (
        normalizedKey === 'imagepath'
        || normalizedKey === 'outputpath'
        || normalizedKey === 'filepath'
        || normalizedKey === 'localpath'
        || normalizedKey === 'localfilepath'
        || normalizedKey === 'artifactpath'
        || normalizedKey === 'imageurl'
        || normalizedKey === 'path'
        || normalizedKey === 'url'
        || normalizedKey === 'b64json'
        || normalizedKey === 'base64'
        || normalizedKey === 'imagebase64'
      ) {
        collectStringValues(nested, output)
      } else if (
        normalizedKey === 'image'
        || normalizedKey === 'images'
        || normalizedKey === 'imagepaths'
        || normalizedKey === 'imageurls'
        || normalizedKey === 'output'
        || normalizedKey === 'outputs'
        || normalizedKey === 'result'
        || normalizedKey === 'results'
        || normalizedKey === 'item'
        || normalizedKey === 'items'
        || normalizedKey === 'content'
        || normalizedKey === 'contents'
        || normalizedKey === 'data'
        || normalizedKey === 'artifact'
        || normalizedKey === 'artifacts'
        || normalizedKey === 'file'
        || normalizedKey === 'files'
      ) {
        collectStringValues(nested, output)
      }
    }
  }
  return output
}

function extractJsonObjects(text: string): unknown[] {
  const candidates: unknown[] = []
  const trimmed = text.trim()
  if (!trimmed) return candidates

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const directText = fenced?.[1]?.trim() || trimmed
  try {
    candidates.push(JSON.parse(directText))
    return candidates
  } catch {
    // Fall through to scan line-delimited and embedded JSON objects.
  }

  for (const line of directText.split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (!trimmedLine || (!trimmedLine.startsWith('{') && !trimmedLine.startsWith('['))) {
      continue
    }
    try {
      candidates.push(JSON.parse(trimmedLine))
    } catch {
      // Ignore non-JSON log lines and continue scanning.
    }
  }
  if (candidates.length > 0) {
    return candidates
  }

  const objectMatches = directText.match(/\{[\s\S]*?\}/g) || []
  for (const match of objectMatches) {
    try {
      candidates.push(JSON.parse(match))
    } catch {
      // Ignore malformed snippets and continue scanning.
    }
  }
  return candidates
}

function extractImagePathCandidates(text: string): string[] {
  const candidates: string[] = []
  for (const parsed of extractJsonObjects(text)) {
    candidates.push(...collectStringValues(parsed))
  }

  const dataUrls = text.matchAll(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi)
  for (const match of dataUrls) {
    if (match[0]) candidates.push(match[0])
  }

  const markdownLinks = text.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)
  for (const match of markdownLinks) {
    if (match[1]) candidates.push(match[1])
  }

  const loosePaths = text.matchAll(/(?:file:\/\/\/)?(?:[A-Za-z]:[\\/][^\s"'<>|]+|\.{0,2}[\\/][^\s"'<>|]+|[^\s"'<>|]+?\.(?:png|jpe?g|webp|gif))/gi)
  for (const match of loosePaths) {
    if (match[0]) candidates.push(match[0])
  }

  return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)))
}

async function existingImagePath(rawCandidate: string, roots: string[]): Promise<string | null> {
  let candidate = rawCandidate.replace(/^["']|["']$/g, '')
  if (candidate.startsWith('file:')) {
    try {
      candidate = fileURLToPath(candidate)
    } catch {
      return null
    }
  }

  const candidatePaths = path.isAbsolute(candidate)
    ? [candidate]
    : roots.map((root) => path.resolve(root, candidate))

  for (const candidatePath of candidatePaths) {
    const ext = path.extname(candidatePath).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) continue
    try {
      const stat = await fs.stat(candidatePath)
      if (stat.isFile() && stat.size > 0) return candidatePath
    } catch {
      // Try the next candidate path.
    }
  }

  return null
}

function normalizeComparablePath(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function resolveImageCandidate(
  rawCandidate: string,
  roots: string[],
  tempDir: string,
  excludedPaths: Set<string>,
): Promise<string | null> {
  const candidate = rawCandidate.trim().replace(/^["']|["']$/g, '')
  if (candidate.startsWith('data:image/')) {
    return await writeDataUrlImage(candidate, tempDir)
  }
  const imagePath = await existingImagePath(candidate, roots)
  if (!imagePath) return null
  if (excludedPaths.has(normalizeComparablePath(imagePath))) return null
  return imagePath
}

async function findNewestImageFile(root: string): Promise<string | null> {
  const pending: string[] = [root]
  let newest: { path: string; mtimeMs: number } | null = null
  let visited = 0

  while (pending.length > 0 && visited < 500) {
    const current = pending.shift()
    if (!current) break
    visited += 1

    let entries: Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(entryPath)
        continue
      }
      if (!entry.isFile() || !IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue
      }

      try {
        const stat = await fs.stat(entryPath)
        if (stat.size <= 0) continue
        if (!newest || stat.mtimeMs > newest.mtimeMs) {
          newest = { path: entryPath, mtimeMs: stat.mtimeMs }
        }
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }

  return newest?.path || null
}

async function resolveCodexGeneratedImagePath(params: {
  text: string
  extraTexts?: string[]
  excludePaths?: string[]
  cwd: string
  tempDir: string
}): Promise<string | null> {
  const roots = Array.from(new Set([params.cwd, params.tempDir]))
  const excludedPaths = new Set((params.excludePaths || []).map(normalizeComparablePath))
  const searchText = [params.text, ...(params.extraTexts || [])].filter(Boolean).join('\n')
  for (const candidate of extractImagePathCandidates(searchText)) {
    const imagePath = await resolveImageCandidate(candidate, roots, params.tempDir, excludedPaths)
    if (imagePath) return imagePath
  }

  return await findNewestImageFile(params.tempDir)
}

export async function runCodexImageGeneration(
  params: CodexImageGenerationParams,
): Promise<CodexImageGenerationResult> {
  const executablePath = resolveCodexExecutablePath(params.codexPath)
  await assertCodexExecutableExists(executablePath)

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-codex-image-'))
  const outputPath = path.join(tempDir, 'last-message.json')
  const cwd = params.cwd || tempDir
  const args = buildCodexImageExecArgs({
    model: params.model,
    outputPath,
    imagePaths: params.imagePaths,
  })
  const timeoutMs = params.timeoutMs ?? readTimeoutMs(process.env.CODEX_IMAGE_TIMEOUT_MS || process.env.CODEX_LLM_TIMEOUT_MS)

  try {
    const result = await spawnCodex(executablePath, args, {
      cwd,
      timeoutMs,
      stdin: params.prompt,
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
    const imagePath = await resolveCodexGeneratedImagePath({
      text,
      extraTexts: [result.stdout, result.stderr],
      excludePaths: params.imagePaths,
      cwd,
      tempDir,
    })
    if (!imagePath) {
      throw new CodexExecError(
        'CODEX_IMAGE_OUTPUT_NOT_FOUND',
        'Codex image generation completed without a readable image path',
        {
          exitCode: result.exitCode,
          signal: result.signal,
          stdout: truncateForError(result.stdout),
          stderr: truncateForError(result.stderr),
        },
      )
    }

    const imageBytes = await fs.readFile(imagePath)
    const mimeType = inferImageMimeType(imageBytes, imagePath)
    return {
      imagePath,
      imageBase64: imageBytes.toString('base64'),
      mimeType,
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
