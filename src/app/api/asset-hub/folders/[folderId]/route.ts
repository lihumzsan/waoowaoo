import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

// 更新文件夹
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ folderId: string }> }
) => {
    const { folderId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const body = await request.json()
    const { name } = body

    if (!name?.trim()) {
        throw new ApiError('INVALID_PARAMS')
    }

    // 验证所有权
    const folder = await prisma.globalAssetFolder.findUnique({
        where: { id: folderId }
    })

    if (!folder || folder.userId !== session.user.id) {
        throw new ApiError('FORBIDDEN')
    }

    const updatedFolder = await prisma.globalAssetFolder.update({
        where: { id: folderId },
        data: { name: name.trim() }
    })

    return NextResponse.json({ success: true, folder: updatedFolder })
})

// 删除文件夹
export const DELETE = apiHandler(async (
    _request: NextRequest,
    context: { params: Promise<{ folderId: string }> }
) => {
    const { folderId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    // 验证所有权
    const folder = await prisma.globalAssetFolder.findUnique({
        where: { id: folderId }
    })

    if (!folder || folder.userId !== session.user.id) {
        throw new ApiError('FORBIDDEN')
    }

    // 删除前，将文件夹内的资产移动到根目录（folderId = null）
    await prisma.globalCharacter.updateMany({
        where: { folderId },
        data: { folderId: null }
    })

    await prisma.globalLocation.updateMany({
        where: { folderId },
        data: { folderId: null }
    })

    // 删除文件夹
    await prisma.globalAssetFolder.delete({
        where: { id: folderId }
    })

    return NextResponse.json({ success: true })
})
