import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'

export type ProjectAgentCommandHttpBody = Record<string, unknown>

function isRecord(value: unknown): value is ProjectAgentCommandHttpBody {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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
  const bodyEpisodeId = readProjectAgentCommandString(body.episodeId)
  if (bodyEpisodeId) return bodyEpisodeId
  if (!isRecord(body.context)) return null
  return readProjectAgentCommandString(body.context.episodeId)
}

export function readProjectAgentCommandString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function mapProjectAgentCommandError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof Error) {
    if (
      error.message === 'PROJECT_AGENT_MODEL_NOT_CONFIGURED'
      || error.message === 'PROJECT_AGENT_ASSISTANT_MODEL_NOT_CONFIGURED'
      || error.message.startsWith('PROJECT_AGENT_ASSISTANT_MODEL_INVALID:')
    ) {
      return new ApiError('MISSING_CONFIG', {
        code: error.message.startsWith('PROJECT_AGENT_ASSISTANT_MODEL_INVALID:')
          ? 'PROJECT_AGENT_ASSISTANT_MODEL_INVALID'
          : error.message,
        message: 'assistant model is required before using project assistant',
      })
    }
    if (
      error.message === 'PROJECT_AGENT_INVALID_MESSAGES'
      || error.message === 'PROJECT_AGENT_EMPTY_MESSAGES'
      || error.message === 'PROJECT_AGENT_EPISODE_REQUIRED'
      || error.message === 'PROJECT_ASSISTANT_INVALID_THREAD_MESSAGES'
      || error.message === 'PROJECT_AGENT_TOOL_SELECTION_INVALID'
      || error.message === 'PROJECT_AGENT_TOOL_SELECTION_TOO_LARGE'
      || error.message === 'PROJECT_AGENT_MESSAGE_SUMMARY_EMPTY'
      || error.message === 'PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_REQUIRED'
      || error.message === 'PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_INVALID'
      || error.message === 'PROJECT_AGENT_CONTROL_INVALID'
      || error.message === 'PROJECT_AGENT_CONTROL_ENDPOINT_REQUIRED'
      || error.message === 'PROJECT_AGENT_CHOICE_RESPONSE_INVALID'
      || error.message === 'PROJECT_AGENT_MESSAGES_NOT_ACCEPTED'
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
      || error.message === 'PROJECT_AGENT_CHOICE_OFFER_IDENTITY_MISMATCH'
    ) {
      return new ApiError('CONFLICT', {
        code: error.message,
        message: error.message,
      })
    }
    if (error.message === 'PROJECT_AGENT_RUN_NOT_FOUND') {
      return new ApiError('CONFLICT', {
        code: error.message,
        message: 'the agent run is not available for this control action',
      })
    }
    if (error.message === 'PROJECT_AGENT_INTERRUPTION_NOT_PENDING') {
      return new ApiError('CONFLICT', {
        code: error.message,
        message: 'the approval interruption is not pending (already consumed, superseded, or unknown)',
      })
    }
    if (error.message === 'PROJECT_AGENT_CHOICE_INTERRUPTION_NOT_PENDING') {
      return new ApiError('CONFLICT', {
        code: error.message,
        message: 'the choice interruption is not pending (already consumed, superseded, or unknown)',
      })
    }
    if (error.message === 'PROJECT_AGENT_RUN_ACTIVE') {
      return new ApiError('CONFLICT', {
        code: error.message,
        message: 'another assistant run is already active for this thread',
      })
    }
    if (error.message.startsWith('PROJECT_AGENT_THREAD_ACTIVE:')) {
      return new ApiError('CONFLICT', {
        code: 'PROJECT_AGENT_THREAD_ACTIVE',
        message: 'assistant thread cannot be cleared while an assistant run is active or waiting',
      })
    }
    if (
      error.message.startsWith('PROJECT_AGENT_CONTROL_EXECUTION_OUTCOME_UNKNOWN:')
      || error.message.startsWith('PROJECT_AGENT_CONTROL_RETRY_NOT_ALLOWED:')
      || error.message.startsWith('PROJECT_AGENT_CONSUMED_CONTROL_RETRY_INVALID:')
    ) {
      return new ApiError('CONFLICT', {
        code: error.message.split(':', 1)[0] ?? 'PROJECT_AGENT_CONTROL_RETRY_REJECTED',
        message: error.message,
      })
    }
  }

  return new ApiError('EXTERNAL_ERROR', {
    code: 'PROJECT_AGENT_RUNTIME_FAILED',
    message: error instanceof Error ? error.message : String(error),
  })
}
