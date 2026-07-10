import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { POST as chatPost } from '../../chat/route'

type ProjectAgentRunControlKind = 'approval_response' | 'choice_response'
type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function readJsonBody(request: NextRequest): Promise<UnknownRecord> {
  try {
    const body: unknown = await request.json()
    if (!isRecord(body)) {
      throw new Error('PROJECT_AGENT_CONTROL_INVALID')
    }
    return body
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_AGENT_CONTROL_INVALID') {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROJECT_AGENT_CONTROL_INVALID',
        message: error.message,
      })
    }
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid JSON',
    })
  }
}

function buildControlPayload(params: {
  kind: ProjectAgentRunControlKind
  runId: string
  body: UnknownRecord
}): UnknownRecord {
  if (params.kind === 'approval_response') {
    return {
      type: 'approval_response',
      runId: params.runId,
      interruptionId: params.body.interruptionId,
      approved: params.body.approved,
      reason: params.body.reason,
    }
  }

  if (params.kind === 'choice_response') {
    return {
      type: 'choice_response',
      runId: params.runId,
      interruptionId: params.body.interruptionId,
      cardId: params.body.cardId,
      toolCallId: params.body.toolCallId,
      output: params.body.output,
    }
  }

  const unreachable: never = params.kind
  throw new Error(`PROJECT_AGENT_RUN_CONTROL_KIND_INVALID:${String(unreachable)}`)
}

function buildDelegatedChatBody(params: {
  kind: ProjectAgentRunControlKind
  runId: string
  body: UnknownRecord
}): UnknownRecord {
  return {
    context: params.body.context,
    episodeId: params.body.episodeId,
    locale: params.body.locale,
    assistantPermissionMode: params.body.assistantPermissionMode,
    visibleUserText: params.body.visibleUserText,
    control: buildControlPayload(params),
  }
}

function assertNoLegacyMessagesField(body: UnknownRecord): void {
  if (Object.prototype.hasOwnProperty.call(body, 'messages')) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_AGENT_MESSAGES_NOT_ACCEPTED',
      message: 'messages is not accepted by assistant run control endpoints',
    })
  }
}

function buildDelegatedHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  headers.set('x-project-agent-run-control', '1')
  headers.delete('content-length')
  return headers
}

export async function handleProjectAgentRunControlRequest(params: {
  request: NextRequest
  projectId: string
  runId: string
  kind: ProjectAgentRunControlKind
}): Promise<Response> {
  const body = await readJsonBody(params.request)
  assertNoLegacyMessagesField(body)
  const url = new URL(`/api/projects/${params.projectId}/assistant/chat`, params.request.url)
  const delegatedRequest = new NextRequest(url, {
    method: 'POST',
    headers: buildDelegatedHeaders(params.request),
    body: JSON.stringify(buildDelegatedChatBody({
      kind: params.kind,
      runId: params.runId,
      body,
    })),
  })
  return await chatPost(delegatedRequest, {
    params: Promise.resolve({ projectId: params.projectId }),
  })
}
