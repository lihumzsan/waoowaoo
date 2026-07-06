import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { parseProjectAssistantTextAttachmentFile } from '@/lib/project-agent/text-attachments/parser'

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
    message: error instanceof Error ? error.message : String(error),
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

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FORM_DATA_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid multipart/form-data',
    })
  }

  try {
    const file = readUploadedFile(formData.get('file'))
    const attachment = await parseProjectAssistantTextAttachmentFile(file)
    return NextResponse.json({ attachment })
  } catch (error) {
    throw mapTextAttachmentError(error)
  }
})
