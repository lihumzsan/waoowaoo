import { createScopedLogger } from './core'

type AnyRecord = Record<string, unknown>
type SemanticLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

function toDetails(input: unknown): AnyRecord | unknown[] | null {
  if (input == null) return null
  if (Array.isArray(input)) return input
  if (typeof input === 'object') return input as AnyRecord
  return { value: input }
}

export function logInternal(
  module: string,
  level: SemanticLevel,
  message: string,
  details?: unknown,
  projectId?: string,
): void {
  createScopedLogger({ module }).event({
    level,
    action: 'internal',
    message,
    projectId,
    details: toDetails(details),
  })
}

export function logProjectAction(
  action: string,
  userId: string | null | undefined,
  username: string | null | undefined,
  projectId: string | null | undefined,
  projectName: string | null | undefined,
  details?: unknown,
): void {
  createScopedLogger({ module: 'project' }).event({
    level: 'INFO',
    audit: true,
    action,
    message: action,
    userId: userId ?? undefined,
    projectId: projectId ?? undefined,
    details: {
      ...(typeof details === 'object' && details != null ? (details as AnyRecord) : { details }),
      username,
      projectName,
    },
  })
}

export function logAuthAction(
  action: string,
  message: unknown,
  details?: unknown,
  userId?: string,
  username?: string,
): void {
  createScopedLogger({ module: 'auth' }).event({
    level: 'INFO',
    audit: true,
    action,
    message: typeof message === 'string' ? message : action,
    userId,
    details: {
      ...(typeof details === 'object' && details != null ? (details as AnyRecord) : { details }),
      username,
    },
  })
}
