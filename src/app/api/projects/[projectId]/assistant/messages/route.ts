import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { readAssistantRuntimeMessagePage } from '@/lib/assistant-runtime/message-store'
import {
  mapProjectAgentCommandError,
  readRequiredProjectAgentCommandString,
} from '../command-http'

export const runtime = 'nodejs'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    const keys = [...request.nextUrl.searchParams.keys()]
    if (
      keys.some((key) => key !== 'threadId' && key !== 'before')
      || request.nextUrl.searchParams.getAll('threadId').length !== 1
      || request.nextUrl.searchParams.getAll('before').length !== 1
    ) {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_PAGE_QUERY_INVALID')
    }
    const threadId = readRequiredProjectAgentCommandString(
      request.nextUrl.searchParams.get('threadId'),
      'ASSISTANT_RUNTIME_THREAD_ID_INVALID',
    )
    const before = readRequiredProjectAgentCommandString(
      request.nextUrl.searchParams.get('before'),
      'ASSISTANT_RUNTIME_MESSAGE_CURSOR_INVALID',
      32,
    )
    const scope = {
      projectId,
      userId: authResult.project.userId,
      assistantId: 'workspace-command' as const,
    }
    const page = await readAssistantRuntimeMessagePage({
      scope,
      threadId,
      before,
    })
    return NextResponse.json({
      protocol: 'assistant_runtime_message_page_v1',
      scope,
      ...page,
    })
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})
