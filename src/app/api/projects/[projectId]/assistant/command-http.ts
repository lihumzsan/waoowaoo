import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import {
  TemporalAgentTurnCommandConflictError,
  TemporalAgentTurnCommandUnconfirmedError,
} from '@/lib/temporal/agent-thread/client'

export type ProjectAgentCommandHttpBody = Record<string, unknown>

function isRecord(value: unknown): value is ProjectAgentCommandHttpBody {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function assertProjectAgentCommandKeys(
  body: ProjectAgentCommandHttpBody,
  allowed: readonly string[],
  code: string,
): void {
  const allowedKeys = new Set(allowed)
  const unexpected = Object.keys(body).filter((key) => !allowedKeys.has(key))
  if (unexpected.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code,
      message: `${code}:${unexpected.sort().join(',')}`,
    })
  }
}

export async function readProjectAgentCommandHttpBody(
  request: NextRequest,
): Promise<ProjectAgentCommandHttpBody> {
  try {
    const body: unknown = await request.json()
    if (!isRecord(body)) throw new Error('PROJECT_AGENT_COMMAND_BODY_INVALID')
    return body
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_AGENT_COMMAND_BODY_INVALID') {
      throw new ApiError('INVALID_PARAMS', {
        code: error.message,
        field: 'body',
        message: 'request body must be a JSON object',
      })
    }
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid JSON',
    })
  }
}

export function readProjectAgentCommandEpisodeId(
  body: ProjectAgentCommandHttpBody,
): string | null {
  const bodyEpisodeId = readNullableProjectAgentCommandString(
    body.episodeId,
    'AGENT_TURN_EPISODE_ID_INVALID',
  )
  const contextEpisodeId = isRecord(body.context)
    ? readNullableProjectAgentCommandString(
        body.context.episodeId,
        'AGENT_TURN_EPISODE_ID_INVALID',
      )
    : null
  if (
    bodyEpisodeId !== null
    && contextEpisodeId !== null
    && bodyEpisodeId !== contextEpisodeId
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'AGENT_TURN_EPISODE_SCOPE_DIVERGED',
      message: 'AGENT_TURN_EPISODE_SCOPE_DIVERGED',
    })
  }
  return bodyEpisodeId ?? contextEpisodeId
}

export function readProjectAgentCommandString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function readNullableProjectAgentCommandString(
  value: unknown,
  code: string,
  maxLength = 191,
): string | null {
  if (value === undefined || value === null) return null
  if (
    typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > maxLength
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code,
      message: code,
    })
  }
  return value
}

export function readRequiredProjectAgentCommandString(
  value: unknown,
  code: string,
  maxLength = 191,
): string {
  if (
    typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > maxLength
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code,
      message: code,
    })
  }
  return value
}

function collectErrorText(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  for (let depth = 0; depth < 8 && current && !seen.has(current); depth += 1) {
    seen.add(current)
    if (current instanceof Error && current.message) {
      parts.push(current.message)
      current = current.cause
      continue
    }
    if (typeof current === 'object' && !Array.isArray(current)) {
      const record = current as Record<string, unknown>
      if (typeof record.message === 'string') parts.push(record.message)
      current = record.cause
      continue
    }
    break
  }
  return parts.join('\n')
}

function readAgentTurnErrorCode(text: string): string | null {
  return text.match(
    /\b(?:AGENT|TEMPORAL|PROJECT_AGENT|PROJECT_ASSISTANT)_[A-Z0-9_]+\b/,
  )?.[0] ?? null
}

export function mapProjectAgentCommandError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof TemporalAgentTurnCommandUnconfirmedError) {
    return new ApiError('EXTERNAL_ERROR', {
      code: 'AGENT_TEMPORAL_UNAVAILABLE',
      message: 'AGENT_TEMPORAL_UNAVAILABLE',
      commandId: error.commandId,
    })
  }
  if (error instanceof TemporalAgentTurnCommandConflictError) {
    return new ApiError('CONFLICT', {
      code: error.code,
      message: error.code,
      commandId: error.commandId,
    })
  }
  const errorText = collectErrorText(error)
  const agentTurnCode = readAgentTurnErrorCode(errorText)
  if (
    agentTurnCode
    && (
      agentTurnCode.endsWith('_INVALID')
      || agentTurnCode.endsWith('_REQUIRED')
      || agentTurnCode.endsWith('_FORBIDDEN')
      || agentTurnCode.endsWith('_TOO_LARGE')
    )
  ) {
    return new ApiError('INVALID_PARAMS', {
      code: agentTurnCode,
      message: agentTurnCode,
    })
  }
  if (
    agentTurnCode
    && (
      agentTurnCode === 'AGENT_THREAD_BUSY'
      || agentTurnCode === 'AGENT_THREAD_CLEARED'
      || agentTurnCode === 'AGENT_THREAD_CLEAR_ALREADY_IN_FLIGHT'
      || agentTurnCode === 'AGENT_TURN_COMMAND_REPLAY_DIVERGED'
      || agentTurnCode.endsWith('_SCOPE_DIVERGED')
      || agentTurnCode.endsWith('_NOT_FOUND')
      || agentTurnCode.endsWith('_NOT_READY')
      || agentTurnCode.endsWith('_REJECTED')
      || agentTurnCode.endsWith('_REPLAY_DIVERGED')
      || agentTurnCode.endsWith('_RESPONSE_DIVERGED')
    )
  ) {
    return new ApiError('CONFLICT', {
      code: agentTurnCode,
      message: agentTurnCode,
    })
  }
  if (error instanceof Error) {
    if (
      error.message === 'PROJECT_AGENT_ASSISTANT_MODEL_NOT_CONFIGURED'
      || error.message.startsWith('PROJECT_AGENT_ASSISTANT_MODEL_INVALID:')
    ) {
      const code = error.message.startsWith(
        'PROJECT_AGENT_ASSISTANT_MODEL_INVALID:',
      )
        ? 'PROJECT_AGENT_ASSISTANT_MODEL_INVALID'
        : error.message
      return new ApiError('MISSING_CONFIG', {
        code,
        message: code,
      })
    }
    if (
      error.message === 'PROJECT_AGENT_INVALID_MESSAGES'
      || error.message === 'PROJECT_ASSISTANT_INVALID_THREAD_MESSAGES'
      || error.message === 'PROJECT_AGENT_CHOICE_RESPONSE_INVALID'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENTS_INVALID'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENTS_TOO_MANY'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_INVALID'
    ) {
      return new ApiError('INVALID_PARAMS', {
        code: error.message,
        message: error.message,
      })
    }
    if (
      error.message === 'PROJECT_AGENT_CHOICE_OFFER_STALE'
    ) {
      return new ApiError('CONFLICT', {
        code: error.message,
        message: error.message,
      })
    }
  }

  const runtimeError = new ApiError('EXTERNAL_ERROR', {
    code: 'PROJECT_AGENT_RUNTIME_FAILED',
    message: 'PROJECT_AGENT_RUNTIME_FAILED',
  })
  runtimeError.cause = error
  return runtimeError
}
