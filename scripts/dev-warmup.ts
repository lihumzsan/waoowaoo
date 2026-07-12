import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'
const DEFAULT_STARTUP_TIMEOUT_MS = 120_000
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000
const STARTUP_RETRY_DELAY_MS = 500
const PROJECT_START_SUCCESS_BANNER = '=========项目启动成功==========='
const DEFAULT_PROJECT_NAME = '蛊真人后传'

export type WarmupResult = {
  path: string
  status: number | 'error'
  elapsedMs: number
}

export type WarmupOptions = {
  baseUrl: string
  username: string
  password: string
  projectName?: string
  nodeEnv?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  startupTimeoutMs?: number
  requestTimeoutMs?: number
  log?: (message: string) => void
}

type RequestOutcome = {
  result: WarmupResult
  response: Response | null
}

type ProjectListPayload = {
  projects?: Array<{ id?: unknown; name?: unknown }>
}

type ProjectDataPayload = {
  project?: {
    novelPromotionData?: {
      episodes?: Array<{ id?: unknown }>
    }
  }
}

export function assertWarmupEnvironment(baseUrl: string, nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') {
    throw new Error('dev warmup cannot run in production')
  }

  const url = new URL(baseUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('dev warmup only allows a local HTTP target')
  }
}

function readSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const separate = headers.getSetCookie?.()
  if (separate && separate.length > 0) return separate

  const combined = response.headers.get('set-cookie')
  if (!combined) return []
  return combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/)
}

export function mergeResponseCookies(
  current: Map<string, string>,
  response: Response,
): Map<string, string> {
  const next = new Map(current)
  for (const setCookie of readSetCookieHeaders(response)) {
    const pair = setCookie.split(';', 1)[0]?.trim()
    if (!pair) continue
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    next.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
  return next
}

function toCookieHeader(cookies: Map<string, string>): string {
  return [...cookies.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

function logResult(result: WarmupResult, log: (message: string) => void): void {
  log(`[dev:warmup] ${result.path} status=${result.status} elapsed=${result.elapsedMs}ms`)
}

async function requestOnce(
  baseUrl: string,
  pathName: string,
  fetchImpl: typeof fetch,
  requestTimeoutMs: number,
  init: RequestInit = {},
): Promise<RequestOutcome> {
  const startedAt = Date.now()
  try {
    const response = await fetchImpl(`${baseUrl}${pathName}`, {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    return {
      result: {
        path: pathName,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
      },
      response,
    }
  } catch {
    return {
      result: {
        path: pathName,
        status: 'error',
        elapsedMs: Date.now() - startedAt,
      },
      response: null,
    }
  }
}

export async function runDevWarmup(options: WarmupOptions): Promise<WarmupResult[]> {
  const {
    baseUrl,
    username,
    password,
    projectName = DEFAULT_PROJECT_NAME,
    nodeEnv,
    fetchImpl = fetch,
    sleep = async (ms) => await new Promise((resolve) => setTimeout(resolve, ms)),
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    log = console.log,
  } = options

  assertWarmupEnvironment(baseUrl, nodeEnv)
  const results: WarmupResult[] = []
  const startupDeadline = Date.now() + startupTimeoutMs

  let landing: RequestOutcome
  do {
    landing = await requestOnce(baseUrl, '/zh', fetchImpl, requestTimeoutMs)
    if (landing.response) break
    await sleep(STARTUP_RETRY_DELAY_MS)
  } while (Date.now() < startupDeadline)

  results.push(landing.result)
  logResult(landing.result, log)
  if (!landing.response?.ok) return results

  let cookies = mergeResponseCookies(new Map(), landing.response)
  const csrf = await requestOnce(baseUrl, '/api/auth/csrf', fetchImpl, requestTimeoutMs, {
    headers: { cookie: toCookieHeader(cookies) },
  })
  if (!csrf.response?.ok) {
    results.push(csrf.result)
    logResult(csrf.result, log)
    return results
  }

  cookies = mergeResponseCookies(cookies, csrf.response)
  let csrfToken: string | undefined
  try {
    const payload = await csrf.response.json() as { csrfToken?: unknown }
    csrfToken = typeof payload.csrfToken === 'string' ? payload.csrfToken : undefined
  } catch {
    csrfToken = undefined
  }
  if (!csrfToken) {
    const invalidCsrf = { ...csrf.result, status: 'error' as const }
    results.push(invalidCsrf)
    logResult(invalidCsrf, log)
    return results
  }

  const loginBody = new URLSearchParams({
    csrfToken,
    username,
    password,
    callbackUrl: `${baseUrl}/zh/home`,
    json: 'true',
  })
  const login = await requestOnce(
    baseUrl,
    '/api/auth/callback/credentials',
    fetchImpl,
    requestTimeoutMs,
    {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: toCookieHeader(cookies),
      },
      body: loginBody,
    },
  )
  if (!login.response?.ok) {
    results.push(login.result)
    logResult(login.result, log)
    return results
  }
  cookies = mergeResponseCookies(cookies, login.response)

  const cookieHeader = toCookieHeader(cookies)
  for (const pathName of ['/api/auth/session', '/zh/home']) {
    const outcome = await requestOnce(baseUrl, pathName, fetchImpl, requestTimeoutMs, {
      headers: { cookie: cookieHeader },
    })
    results.push(outcome.result)
    logResult(outcome.result, log)
  }

  const projects = await requestOnce(
    baseUrl,
    '/api/projects?page=1&pageSize=5',
    fetchImpl,
    requestTimeoutMs,
    { headers: { cookie: cookieHeader } },
  )
  results.push(projects.result)
  logResult(projects.result, log)
  if (!projects.response?.ok) return results

  let projectId: string | undefined
  try {
    const payload = await projects.response.json() as ProjectListPayload
    const project = payload.projects?.find((candidate) => candidate.name === projectName)
    projectId = typeof project?.id === 'string' ? project.id : undefined
  } catch {
    projectId = undefined
  }
  if (!projectId) {
    log(`[dev:warmup] project=${projectName} skipped=not-found`)
    return results
  }

  const workspacePath = `/zh/workspace/${projectId}`
  const workspace = await requestOnce(baseUrl, workspacePath, fetchImpl, requestTimeoutMs, {
    headers: { cookie: cookieHeader },
  })
  results.push(workspace.result)
  logResult(workspace.result, log)

  const projectDataPath = `/api/projects/${projectId}/data`
  const projectData = await requestOnce(baseUrl, projectDataPath, fetchImpl, requestTimeoutMs, {
    headers: { cookie: cookieHeader },
  })
  results.push(projectData.result)
  logResult(projectData.result, log)
  if (!projectData.response?.ok) return results

  let episodeId: string | undefined
  try {
    const payload = await projectData.response.json() as ProjectDataPayload
    const episode = payload.project?.novelPromotionData?.episodes
      ?.find((candidate) => typeof candidate.id === 'string')
    episodeId = typeof episode?.id === 'string' ? episode.id : undefined
  } catch {
    episodeId = undefined
  }
  if (!episodeId) {
    log(`[dev:warmup] project=${projectName} skipped=no-episode`)
    return results
  }

  const runSearch = new URLSearchParams({
    projectId,
    workflowType: 'story_to_script_run',
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    episodeId,
    limit: '20',
  })
  runSearch.append('status', 'queued')
  runSearch.append('status', 'running')
  runSearch.append('status', 'canceling')
  runSearch.set('_v', '2')

  for (const pathName of [
    `${workspacePath}?episode=${encodeURIComponent(episodeId)}`,
    `/api/novel-promotion/${projectId}/episodes/${episodeId}?profile=config`,
    `/api/runs?${runSearch.toString()}`,
  ]) {
    const outcome = await requestOnce(baseUrl, pathName, fetchImpl, requestTimeoutMs, {
      headers: { cookie: cookieHeader },
    })
    results.push(outcome.result)
    logResult(outcome.result, log)
  }

  const allRequestsSucceeded = results.every(
    (result) => typeof result.status === 'number' && result.status >= 200 && result.status < 300,
  )
  if (allRequestsSucceeded) {
    log(PROJECT_START_SUCCESS_BANNER)
  }

  return results
}

async function main(): Promise<void> {
  await runDevWarmup({
    baseUrl: DEFAULT_BASE_URL,
    username: 'tigli',
    password: '123456',
    nodeEnv: process.env.NODE_ENV,
  })
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isDirectRun) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.warn(`[dev:warmup] skipped: ${message}`)
  })
}
