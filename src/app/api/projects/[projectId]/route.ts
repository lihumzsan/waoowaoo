import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { addSignedUrlsToProject, deleteObjects } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { logProjectAction } from '@/lib/logging/semantic'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

// GET - 获取项目详情
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // 只获取基础项目信息，不包含模式特定数据
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      user: true
    }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  // 更新最近访问时间（异步，不阻塞响应�?
  prisma.project.update({
    where: { id: projectId },
    data: { lastAccessedAt: new Date() }
  }).catch(err => _ulogError('更新访问时间失败:', err))

  // 这个 API 只返回基础项目信息
  // 项目附属业务数据通过各自�?API 获取（如 /api/novel-promotion/[projectId]�?
  const projectWithSignedUrls = addSignedUrlsToProject(project)

  return NextResponse.json({ project: projectWithSignedUrls })
})

// PATCH - 更新项目配置
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session
  const body = await request.json()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { user: true }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  // 更新项目
  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: body
  })

  logProjectAction(
    'UPDATE',
    session.user.id,
    session.user.name,
    projectId,
    updatedProject.name,
    { changes: body }
  )

  return NextResponse.json({ project: updatedProject })
})

/**
 * 收集项目的所有COS文件Key
 */
async function collectProjectCOSKeys(projectId: string): Promise<string[]> {
  const keys: string[] = []

  // 获取 NovelPromotionProject
  const novelPromotion = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      // 角色及其形象图片
      characters: {
        include: {
          appearances: true
        }
      },
      // 场景及其图片
      locations: {
        include: {
          images: true
        }
      },
      // 剧集（包含音频、分镜等�?
      episodes: {
        include: {
          storyboards: {
            include: {
              panels: true
            }
          }
        }
      }
    }
  })

  if (!novelPromotion) return keys

  // 1. 收集角色形象图片
  for (const character of novelPromotion.characters) {
    for (const appearance of character.appearances) {
      const key = await resolveStorageKeyFromMediaValue(appearance.imageUrl)
      if (key) keys.push(key)
    }
  }

  // 2. 收集场景图片
  for (const location of novelPromotion.locations) {
    for (const image of location.images) {
      const key = await resolveStorageKeyFromMediaValue(image.imageUrl)
      if (key) keys.push(key)
    }
  }

  // 3. 收集剧集相关文件
  for (const episode of novelPromotion.episodes) {
    // 音频文件
    const audioKey = await resolveStorageKeyFromMediaValue(episode.audioUrl)
    if (audioKey) keys.push(audioKey)

    // 分镜图片
    for (const storyboard of episode.storyboards) {
      // 分镜整体�?
      const sbKey = await resolveStorageKeyFromMediaValue(storyboard.storyboardImageUrl)
      if (sbKey) keys.push(sbKey)

      // 候选图片（JSON数组�?
      if (storyboard.candidateImages) {
        try {
          const candidates = JSON.parse(storyboard.candidateImages)
          for (const url of candidates) {
            const key = await resolveStorageKeyFromMediaValue(url)
            if (key) keys.push(key)
          }
        } catch { }
      }

      // Panel 表中的图片和视频
      for (const panel of storyboard.panels) {
        const imgKey = await resolveStorageKeyFromMediaValue(panel.imageUrl)
        if (imgKey) keys.push(imgKey)

        const videoKey = await resolveStorageKeyFromMediaValue(panel.videoUrl)
        if (videoKey) keys.push(videoKey)
      }
    }
  }

  _ulogInfo(`[Project ${projectId}] 收集�?${keys.length} �?COS 文件待删除`)
  return keys
}

// DELETE - 删除项目（同时清理COS文件�?
export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { user: true }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  // 1. 先收集所�?COS 文件 Key
  _ulogInfo(`[DELETE] 开始删除项�? ${project.name} (${projectId})`)
  const cosKeys = await collectProjectCOSKeys(projectId)

  // 2. 批量删除 COS 文件
  let cosResult = { success: 0, failed: 0 }
  if (cosKeys.length > 0) {
    _ulogInfo(`[DELETE] 正在删除 ${cosKeys.length} �?COS 文件...`)
    cosResult = await deleteObjects(cosKeys)
  }

  // 3. 删除数据库记�?(级联删除所有关联数�?
  await prisma.project.delete({
    where: { id: projectId }
  })

  logProjectAction(
    'DELETE',
    session.user.id,
    session.user.name,
    projectId,
    project.name,
    {
      projectName: project.name,
      cosFilesDeleted: cosResult.success,
      cosFilesFailed: cosResult.failed,
    }
  )

  _ulogInfo(`[DELETE] 项目删除完成: ${project.name}`)
  _ulogInfo(`[DELETE] COS 文件: 成功 ${cosResult.success}, 失败 ${cosResult.failed}`)

  return NextResponse.json({
    success: true,
    cosFilesDeleted: cosResult.success,
    cosFilesFailed: cosResult.failed,
  })
})
