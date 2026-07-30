import { describeUnknownError } from '@/lib/errors/normalize'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { parseProjectAssistantTextAttachmentFile } from '@/lib/project-agent/text-attachments/parser'
import { readFormDataWithLimit } from '@/lib/http/body-limits'
import { PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES } from '@/lib/project-agent/text-attachments/types'

function mapTextAttachmentError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof Error) {
    if (
      error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_FILE_NAME_EMPTY'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_UNSUPPORTED_TYPE'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_EMPTY'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_SIZE_LIMIT_EXCEEDED'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_CHAR_LIMIT_EXCEEDED'
    ) {
      return new ApiError('INVALID_PARAMS', {
        code: error.message,
        message: error.message,
      })
    }
  }
  return new ApiError('INTERNAL_ERROR', {
    code: 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_PARSE_FAILED',
    message: describeUnknownError(error),
  })
}

function readUploadedFile(value: FormDataEntryValue | null): File {
  if (typeof File !== 'undefined' && value instanceof File) {
    return value
  }
  throw new ApiError('INVALID_PARAMS', {
    code: 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_FILE_REQUIRED',
    field: 'file',
    message: 'file is required',
  })
}

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const formData = await readFormDataWithLimit(
    request,
    PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES + 1024 * 1024,
    'text attachment upload',
  )

  try {
    const file = readUploadedFile(formData.get('file'))
    const attachment = await parseProjectAssistantTextAttachmentFile(file)
    return NextResponse.json({ attachment })
  } catch (error) {
    throw mapTextAttachmentError(error)
  }
})
