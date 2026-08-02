import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { listWorkspaceResourceTreePage } from '@/lib/workspace-resource/view-service'

function parseLimit(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new ApiError('INVALID_PARAMS', { field: 'limit' })
  }
  return parsed
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const page = await listWorkspaceResourceTreePage({
    projectId,
    userId: auth.session.user.id,
    prefix: request.nextUrl.searchParams.get('prefix'),
    search: request.nextUrl.searchParams.get('search'),
    cursor: request.nextUrl.searchParams.get('cursor'),
    limit: parseLimit(request.nextUrl.searchParams.get('limit')),
    deleted: request.nextUrl.searchParams.get('deleted') === 'true',
  })
  return NextResponse.json({ success: true, page })
})
