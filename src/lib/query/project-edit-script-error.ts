import { resolveTaskErrorMessage } from '@/lib/task/error-message'

interface ApiErrorPayload {
  readonly error?: {
    readonly code?: unknown
    readonly message?: unknown
    readonly details?: unknown
  } | null
  readonly code?: unknown
  readonly message?: unknown
}

interface ProjectEditScriptRequestErrorOptions {
  readonly apiCode: string | null
  readonly detailCode: string | null
}

export class ProjectEditScriptRequestError extends Error {
  readonly apiCode: string | null
  readonly detailCode: string | null

  constructor(message: string, options: ProjectEditScriptRequestErrorOptions) {
    super(message)
    this.name = 'ProjectEditScriptRequestError'
    this.apiCode = options.apiCode
    this.detailCode = options.detailCode
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readErrorCodes(payload: unknown): ProjectEditScriptRequestErrorOptions {
  const root = asObject(payload)
  const error = asObject(root?.error)
  const details = asObject(error?.details)
  return {
    apiCode: asString(error?.code) || asString(root?.code),
    detailCode: asString(details?.code) || null,
  }
}

export async function readProjectEditScriptJsonError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch((): ApiErrorPayload | null => null)
  return new ProjectEditScriptRequestError(resolveTaskErrorMessage(payload, fallback), readErrorCodes(payload))
}

export function readProjectEditScriptRequestErrorCode(error: unknown): string | null {
  if (error instanceof ProjectEditScriptRequestError) {
    return error.detailCode || error.apiCode
  }
  return null
}
