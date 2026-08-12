import type { NextRequest } from 'next/server'
import { ApiError, normalizeError } from '@/lib/api-errors'
import { AssistantRuntimeProjectBusyError } from '@/lib/assistant-runtime'
import { InsufficientBalanceError } from '@/lib/billing'

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
      }, { cause: error })
    }
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid JSON',
    }, { cause: error })
  }
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
    /\b(?:AGENT|TEMPORAL|PROJECT_AGENT|PROJECT_ASSISTANT|ASSISTANT_RUNTIME|CODEX_RUNTIME|CODEX_MODEL_GATEWAY)_[A-Z0-9_]+\b/,
  )?.[0] ?? null
}

export function mapProjectAgentCommandError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof InsufficientBalanceError) return normalizeError(error)
  if (error instanceof AssistantRuntimeProjectBusyError) {
    return new ApiError('AGENT_THREAD_BUSY', {
      code: 'AGENT_THREAD_BUSY',
      message: error.message,
    })
  }
  const errorText = collectErrorText(error)
  const agentTurnCode = readAgentTurnErrorCode(errorText)
  if (agentTurnCode === 'ASSISTANT_RUNTIME_OWNERSHIP_BUSY') {
    return new ApiError('AGENT_THREAD_BUSY', {
      code: 'AGENT_THREAD_BUSY',
      message: agentTurnCode,
    })
  }
  if (agentTurnCode === 'ASSISTANT_RUNTIME_STEER_HANDOFF_UNCERTAIN') {
    return new ApiError('AGENT_STEER_HANDOFF_UNCERTAIN', {
      code: 'AGENT_STEER_HANDOFF_UNCERTAIN',
      message: agentTurnCode,
    })
  }
  if (agentTurnCode === 'ASSISTANT_RUNTIME_START_HANDOFF_UNCERTAIN') {
    return new ApiError('AGENT_START_HANDOFF_UNCERTAIN', {
      code: 'AGENT_START_HANDOFF_UNCERTAIN',
      message: agentTurnCode,
    })
  }
  if (
    agentTurnCode === 'ASSISTANT_RUNTIME_MESSAGE_COMMAND_REPLAY_DIVERGED'
  ) {
    return new ApiError('AGENT_TURN_COMMAND_REPLAY_DIVERGED', {
      code: 'AGENT_TURN_COMMAND_REPLAY_DIVERGED',
      message: agentTurnCode,
    })
  }
  if (
    agentTurnCode === 'CODEX_MODEL_GATEWAY_ASSISTANT_MODEL_NOT_CONFIGURED'
    || agentTurnCode === 'CODEX_MODEL_GATEWAY_ASSISTANT_MODEL_UNSUPPORTED'
    || agentTurnCode === 'CODEX_MODEL_GATEWAY_PROVIDER_RESPONSES_UNSUPPORTED'
    || agentTurnCode === 'CODEX_MODEL_GATEWAY_PROVIDER_CONFIG_UNAVAILABLE'
    || agentTurnCode === 'CODEX_MODEL_GATEWAY_PROVIDER_BASE_URL_INVALID'
  ) {
    return new ApiError('MISSING_CONFIG', {
      code: agentTurnCode,
      message: agentTurnCode,
    })
  }
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
      || agentTurnCode === 'ASSISTANT_RUNTIME_PROJECT_BUSY'
      || agentTurnCode === 'AGENT_THREAD_CLEARED'
      || agentTurnCode === 'AGENT_THREAD_CLEAR_ALREADY_IN_FLIGHT'
      || agentTurnCode === 'ASSISTANT_RUNTIME_COLLABORATION_MODE_LOCKED'
      || agentTurnCode === 'AGENT_TURN_COMMAND_REPLAY_DIVERGED'
      || agentTurnCode.endsWith('_SCOPE_DIVERGED')
      || agentTurnCode.endsWith('_NOT_FOUND')
      || agentTurnCode.endsWith('_NOT_READY')
      || agentTurnCode.endsWith('_NOT_PENDING')
      || agentTurnCode.endsWith('_EXPIRED')
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
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENTS_INVALID'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENTS_TOO_MANY'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_INVALID'
    ) {
      return new ApiError('INVALID_PARAMS', {
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
