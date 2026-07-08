import path from 'node:path'
import { E2E_GENERATION_MODES, E2E_MODES, E2E_TARGET_STAGE_IDS, type E2eGenerationMode, type E2eMode, type E2eRunnerConfig, type E2eTargetStageId } from './types'
import { getE2eTargetStage } from './stages'

interface CliOptionMap {
  readonly [key: string]: string | boolean
}

const DEFAULT_PROMPT = '两分钟左右的科幻短片：一个民科发现了超越光速的方法，然后逆转时间，触发因果律。'

function readCliOptions(argv: readonly string[]): CliOptionMap {
  const result: Record<string, string | boolean> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const trimmed = arg.slice(2)
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex >= 0) {
      result[trimmed.slice(0, equalsIndex)] = trimmed.slice(equalsIndex + 1)
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      result[trimmed] = next
      index += 1
      continue
    }
    result[trimmed] = true
  }
  return result
}

function readStringOption(options: CliOptionMap, key: string, envKey: string, fallback: string): string
function readStringOption(options: CliOptionMap, key: string, envKey: string, fallback: string | null): string | null
function readStringOption(options: CliOptionMap, key: string, envKey: string, fallback: string | null): string | null {
  const cliValue = options[key]
  if (typeof cliValue === 'string' && cliValue.trim()) return cliValue.trim()
  const envValue = process.env[envKey]
  if (typeof envValue === 'string' && envValue.trim()) return envValue.trim()
  return fallback
}

function readNumberOption(options: CliOptionMap, key: string, envKey: string, fallback: number): number {
  const value = readStringOption(options, key, envKey, String(fallback))
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`E2E_OPTION_POSITIVE_INTEGER_REQUIRED:${key}`)
  }
  return parsed
}

function readEnumOption<T extends readonly string[]>(
  options: CliOptionMap,
  key: string,
  envKey: string,
  values: T,
  fallback: T[number],
): T[number] {
  const value = readStringOption(options, key, envKey, fallback)
  if ((values as readonly string[]).includes(value)) return value as T[number]
  throw new Error(`E2E_OPTION_INVALID:${key}:${value}:allowed=${values.join(',')}`)
}

function readTargetStage(options: CliOptionMap): E2eTargetStageId {
  return readEnumOption(options, 'target', 'E2E_TARGET_STAGE', E2E_TARGET_STAGE_IDS, 'assets_approved')
}

function readAspectRatio(options: CliOptionMap): E2eRunnerConfig['aspectRatio'] {
  return readEnumOption(options, 'aspect-ratio', 'E2E_ASPECT_RATIO', ['9:16', '16:9', '21:9'] as const, '16:9')
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function readAssistantPermissionMode(options: CliOptionMap): E2eRunnerConfig['assistantPermissionMode'] {
  return readEnumOption(options, 'permission-mode', 'E2E_ASSISTANT_PERMISSION_MODE', ['ask', 'auto'] as const, 'ask')
}

export function parseE2eRunnerConfig(argv: readonly string[] = process.argv.slice(2)): E2eRunnerConfig {
  const options = readCliOptions(argv)
  const mode: E2eMode = readEnumOption(options, 'mode', 'E2E_MODE', E2E_MODES, 'live')
  const target = readTargetStage(options)
  const generation: E2eGenerationMode = readEnumOption(options, 'generation', 'E2E_GENERATION_MODE', E2E_GENERATION_MODES, 'real')
  const targetDefinition = getE2eTargetStage(target)
  if (targetDefinition.requiresRealGeneration && generation !== 'real') {
    throw new Error(`E2E_TARGET_REQUIRES_REAL_GENERATION:${target}`)
  }
  const baseUrl = normalizeBaseUrl(readStringOption(options, 'base-url', 'E2E_BASE_URL', 'http://localhost:3000'))
  const projectName = readStringOption(options, 'project-name', 'E2E_PROJECT_NAME', `live-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  return {
    mode,
    target,
    generation,
    baseUrl,
    locale: readEnumOption(options, 'locale', 'E2E_LOCALE', ['zh', 'en'] as const, 'zh'),
    username: readStringOption(options, 'username', 'E2E_USERNAME', null),
    password: readStringOption(options, 'password', 'E2E_PASSWORD', null),
    sessionCookie: readStringOption(options, 'session-cookie', 'E2E_SESSION_COOKIE', null),
    prompt: readStringOption(options, 'prompt', 'E2E_PROMPT', DEFAULT_PROMPT),
    projectName,
    episodeName: readStringOption(options, 'episode-name', 'E2E_EPISODE_NAME', 'E2E 剧集 1'),
    projectId: readStringOption(options, 'project-id', 'E2E_PROJECT_ID', null),
    episodeId: readStringOption(options, 'episode-id', 'E2E_EPISODE_ID', null),
    aspectRatio: readAspectRatio(options),
    assistantPermissionMode: readAssistantPermissionMode(options),
    pollIntervalMs: readNumberOption(options, 'poll-ms', 'E2E_POLL_MS', 5_000),
    stageTimeoutMs: readNumberOption(options, 'stage-timeout-ms', 'E2E_STAGE_TIMEOUT_MS', 10 * 60 * 1000),
    overallTimeoutMs: readNumberOption(options, 'overall-timeout-ms', 'E2E_OVERALL_TIMEOUT_MS', 90 * 60 * 1000),
    reportDir: path.resolve(readStringOption(options, 'report-dir', 'E2E_REPORT_DIR', 'artifacts/e2e-long-form')),
  }
}
