export type ComfyUiConfigErrorCode =
  | 'COMFYUI_BASE_URL_MISSING'
  | 'COMFYUI_BASE_URL_INVALID'

export class ComfyUiConfigError extends Error {
  readonly code: ComfyUiConfigErrorCode

  constructor(code: ComfyUiConfigErrorCode) {
    super(code)
    this.name = 'ComfyUiConfigError'
    this.code = code
  }
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
