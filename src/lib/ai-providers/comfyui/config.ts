export type ComfyUiConfigErrorCode =
  | 'COMFYUI_BASE_URL_MISSING'
  | 'COMFYUI_BASE_URL_INVALID'
  | 'COMFYUI_RUNTIME_TARGET_MISSING'
  | 'COMFYUI_RUNTIME_TARGET_INVALID'

export class ComfyUiConfigError extends Error {
  readonly code: ComfyUiConfigErrorCode

  constructor(code: ComfyUiConfigErrorCode) {
    super(code)
    this.name = 'ComfyUiConfigError'
    this.code = code
  }
}

export const COMFYUI_RUNTIME_TARGET_IDS = [
  'shared',
  'h3-dual-stage-2mp',
] as const

export type ComfyUiRuntimeTargetId = (typeof COMFYUI_RUNTIME_TARGET_IDS)[number]

export type ComfyUiRuntimeTarget = {
  readonly id: ComfyUiRuntimeTargetId
  readonly baseUrl: string
}

const ENVIRONMENT_KEY_BY_TARGET: Record<ComfyUiRuntimeTargetId, string> = {
  shared: 'COMFYUI_BASE_URL',
  'h3-dual-stage-2mp': 'COMFYUI_H3_DUAL_STAGE_BASE_URL',
}

function readRuntimeTargetUrl(
  targetId: ComfyUiRuntimeTargetId,
  environment: NodeJS.ProcessEnv,
): string {
  const environmentKey = ENVIRONMENT_KEY_BY_TARGET[targetId]
  const raw = environment[environmentKey]?.trim() || ''
  if (!raw) {
    if (targetId === 'shared') throw new ComfyUiConfigError('COMFYUI_BASE_URL_MISSING')
    throw new Error(`COMFYUI_RUNTIME_TARGET_MISSING:${targetId}`)
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    if (targetId === 'shared') throw new ComfyUiConfigError('COMFYUI_BASE_URL_INVALID')
    throw new Error(`COMFYUI_RUNTIME_TARGET_INVALID:${targetId}`)
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    if (targetId === 'shared') throw new ComfyUiConfigError('COMFYUI_BASE_URL_INVALID')
    throw new Error(`COMFYUI_RUNTIME_TARGET_INVALID:${targetId}`)
  }

  return parsed.toString().replace(/\/$/u, '')
}

export function resolveComfyUiRuntimeTarget(
  targetId: ComfyUiRuntimeTargetId,
  environment: NodeJS.ProcessEnv = process.env,
): ComfyUiRuntimeTarget {
  return { id: targetId, baseUrl: readRuntimeTargetUrl(targetId, environment) }
}

export function readComfyUiBaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const raw = environment.COMFYUI_BASE_URL?.trim() || ''
  if (!raw) throw new ComfyUiConfigError('COMFYUI_BASE_URL_MISSING')

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new ComfyUiConfigError('COMFYUI_BASE_URL_INVALID')
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new ComfyUiConfigError('COMFYUI_BASE_URL_INVALID')
  }

  return parsed.toString().replace(/\/$/u, '')
}
