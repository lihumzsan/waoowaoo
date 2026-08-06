import { AssistantRuntimeProjectBusyError } from '@/lib/assistant-runtime'
import { submitAssistantRuntimeTaskFollowUp } from '@/lib/assistant-runtime'
import {
  AssistantRuntimeTaskFollowUpHttpError,
  parseAssistantRuntimeTaskFollowUpHttpRequest,
  verifyAssistantRuntimeTaskFollowUpAuthorization,
  type AssistantRuntimeTaskFollowUpHttpResponse,
} from '@/lib/assistant-runtime/task-follow-up-http'
import { apiHandler } from '@/lib/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(
  body: AssistantRuntimeTaskFollowUpHttpResponse,
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export const POST = apiHandler(async (request) => {
  let authorized: boolean
  try {
    authorized = verifyAssistantRuntimeTaskFollowUpAuthorization(
      request.headers.get('authorization'),
    )
  } catch {
    return json(
      {
        ok: false,
        code: 'ASSISTANT_RUNTIME_INTERNAL_AUTH_UNAVAILABLE',
      },
      500,
    )
  }
  if (!authorized) {
    return json(
      {
        ok: false,
        code: 'ASSISTANT_RUNTIME_INTERNAL_AUTHENTICATION_FAILED',
      },
      401,
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(
      {
        ok: false,
        code: 'ASSISTANT_RUNTIME_FOLLOW_UP_REQUEST_INVALID',
      },
      400,
    )
  }

  let input: { readonly batchId: string }
  try {
    input = parseAssistantRuntimeTaskFollowUpHttpRequest(body)
  } catch (error) {
    const code = error instanceof AssistantRuntimeTaskFollowUpHttpError
      ? error.code
      : 'ASSISTANT_RUNTIME_FOLLOW_UP_REQUEST_INVALID'
    return json({ ok: false, code }, 400)
  }

  try {
    const receipt = await submitAssistantRuntimeTaskFollowUp(input.batchId)
    return json({ ok: true, receipt }, 200)
  } catch (error) {
    if (error instanceof AssistantRuntimeProjectBusyError) {
      return json(
        {
          ok: false,
          code: 'ASSISTANT_RUNTIME_PROJECT_BUSY',
        },
        409,
      )
    }
    if (request.signal.aborted) {
      return json(
        {
          ok: false,
          code: 'ASSISTANT_RUNTIME_FOLLOW_UP_REQUEST_ABORTED',
        },
        499,
      )
    }
    return json(
      {
        ok: false,
        code: 'ASSISTANT_RUNTIME_FOLLOW_UP_FAILED',
      },
      500,
    )
  }
})
