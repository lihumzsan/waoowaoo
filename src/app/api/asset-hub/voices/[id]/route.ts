import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

// 删除音色
export const DELETE = apiHandler(async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const { id } = await params

    const voice = await prisma.globalVoice.findUnique({
        where: { id }
    })

    if (!voice) {
        throw new ApiError('NOT_FOUND')
    }

    if (voice.userId !== session.user.id) {
        throw new ApiError('FORBIDDEN')
    }

    await prisma.globalVoice.delete({
        where: { id }
    })

    return NextResponse.json({ success: true })
})

// 更新音色
export const PATCH = apiHandler(async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) => {
    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const { id } = await params
    const body = await request.json()

    const voice = await prisma.globalVoice.findUnique({
        where: { id }
    })

    if (!voice) {
        throw new ApiError('NOT_FOUND')
    }

    if (voice.userId !== session.user.id) {
        throw new ApiError('FORBIDDEN')
    }

    const updatedVoice = await prisma.globalVoice.update({
        where: { id },
        data: {
            name: body.name?.trim() || voice.name,
            description: body.description !== undefined ? body.description?.trim() || null : voice.description,
            folderId: body.folderId !== undefined ? body.folderId : voice.folderId
        }
    })

    return NextResponse.json({ success: true, voice: updatedVoice })
})
