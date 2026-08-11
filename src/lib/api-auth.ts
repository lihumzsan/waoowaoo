/**
 * 🔐 API 权限验证工具
 * 集中管理 Session 验证、项目权限检查等通用逻辑
 */

import { getServerSession } from 'next-auth/next'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { withRetry } from '@/lib/retry'
import { extractModelKey } from '@/lib/config-service'
import { getErrorSpec, type UnifiedErrorCode } from '@/lib/errors/codes'
import { getLogContext, setLogContext } from '@/lib/logging/context'
import { projectPublicErrorDetails } from '@/lib/errors/projection'

// ============================================================
// 类型定义
// ============================================================

export interface AuthSession {
    user: {
        id: string
        name?: string | null
        email?: string | null
    }
}

type ExistingAuthUser = {
    id: string
    name: string
    email: string | null
}

function bindAuthLogContext(session: AuthSession, projectId?: string) {
    const context = getLogContext()
    if (!context.requestId) return
    setLogContext({
        userId: session.user.id,
        ...(projectId ? { projectId } : {}),
    })
}

function withCanonicalSessionUser(session: AuthSession, user: ExistingAuthUser): AuthSession {
    return {
        user: {
            id: user.id,
            name: user.name,
            email: user.email ?? session.user.email ?? null,
        },
    }
}

async function resolveExistingSession(session: AuthSession): Promise<AuthSession | null> {
    const userById = await withRetry({
        operation: EXTERNAL_OPERATION.DATABASE_READ,
        scope: 'prisma:requireUserAuth',
        run: async () => await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { id: true, name: true, email: true },
        }),
    })
    return userById ? withCanonicalSessionUser(session, userById) : null
}

async function requireExistingSession(): Promise<AuthSession | null> {
    const session = await getAuthSession()
    if (!session?.user?.id) return null
    return await resolveExistingSession(session)
}

/**
 * 基础 projectData 类型
 */
export interface NovelDataBase {
    id: string
    [key: string]: unknown
}

/**
 * 根据 include 选项推断的 projectData 类型
 */
export interface ProjectAuthContext {
    session: AuthSession
    project: {
        id: string
        userId: string
        name: string
        [key: string]: unknown
    }
    projectData: NovelDataBase
}

// ============================================================
// 错误响应工具
// ============================================================

function buildErrorResponse(code: UnifiedErrorCode, details: Record<string, unknown> = {}) {
    const spec = getErrorSpec(code)
    const requestId = getLogContext().requestId ?? null
    const publicDetails = {
        ...projectPublicErrorDetails(details),
        ...(requestId ? { requestId } : {}),
    }
    return NextResponse.json(
        {
            success: false,
            error: {
                code,
                message: spec.defaultMessage,
                retryable: spec.retryable,
                category: spec.category,
                userMessageKey: spec.userMessageKey,
                details: publicDetails,
            },
        },
        { status: spec.httpStatus },
    )
}

export function unauthorized() {
    return buildErrorResponse('UNAUTHORIZED')
}

export function forbidden() {
    return buildErrorResponse('FORBIDDEN')
}

export function notFound() {
    return buildErrorResponse('NOT_FOUND')
}

export function badRequest() {
    return buildErrorResponse('INVALID_PARAMS')
}

export function serverError() {
    return buildErrorResponse('INTERNAL_ERROR')
}

// ============================================================
// 权限验证函数
// ============================================================

/**
 * 验证用户 Session
 * @returns session 或 null
 */
export async function getAuthSession(): Promise<AuthSession | null> {
    const session = await getServerSession(authOptions)
    return session as AuthSession | null
}

/**
 * 要求用户登录
 * @throws 返回 401 响应
 */
export async function requireAuth(): Promise<AuthSession> {
    const session = await requireExistingSession()
    if (!session) {
        throw { response: unauthorized() }
    }
    bindAuthLogContext(session)
    return session
}

/**
 * 验证项目访问权限
 * 包含：Session 验证 + 项目存在检查 + 所有权验证 + 项目工作流数据检查
 * 
 * @param projectId 项目 ID
 * @param options 可选配置，支持按需加载关联数据
 * @returns 验证上下文（session, project, projectData）
 * @throws 返回对应的错误响应
 * 
 * @example
 * ```typescript
 * // 基础用法（不加载关联数据）
 * const authResult = await requireProjectAuth(projectId)
 * 
 * // 加载 characters 和 locations
 * const authResult = await requireProjectAuth(projectId, {
 *   include: { characters: true, locations: true }
 * })
 * // authResult.projectData.characters 和 locations 自动可用
 * ```
 */
export async function requireProjectAuth(projectId: string): Promise<ProjectAuthContext | NextResponse> {
    // 1. 验证 Session
    const session = await requireExistingSession()
    if (!session) {
        return unauthorized()
    }
    bindAuthLogContext(session, projectId)

    // 2. 获取项目基础信息
    const project = await withRetry({
        operation: EXTERNAL_OPERATION.DATABASE_READ,
        scope: 'prisma:requireProjectAuth',
        run: async () => await prisma.project.findUnique({
            where: { id: projectId },
        }),
    })

    // 4. 项目存在检查
    if (!project) {
        return notFound()
    }

    // 5. 所有权验证
    if (project.userId !== session.user.id) {
        return forbidden()
    }

    // 统一返回 modelKey（provider::modelId），禁止降级为纯 modelId
    const rawProjectData = project as {
        id: string
        analysisModel?: string | null
        characterModel?: string | null
        locationModel?: string | null
        editModel?: string | null
        videoModel?: string | null
        musicModel?: string | null
        soundModel?: string | null
        [key: string]: unknown
    }
    const processedProjectData = {
        ...rawProjectData,
        analysisModel: extractModelKey(rawProjectData.analysisModel),
        characterModel: extractModelKey(rawProjectData.characterModel),
        locationModel: extractModelKey(rawProjectData.locationModel),
        editModel: extractModelKey(rawProjectData.editModel),
        videoModel: extractModelKey(rawProjectData.videoModel),
        musicModel: extractModelKey(rawProjectData.musicModel),
        soundModel: extractModelKey(rawProjectData.soundModel),
    }

    return {
        session,
        project,
        projectData: processedProjectData
    }
}

/**
 * 仅验证 Session，不检查项目权限
 * 适用于用户级 API（如资产库）
 * 
 * @example
 * ```typescript
 * const authResult = await requireUserAuth()
 * if (authResult instanceof NextResponse) return authResult
 * 
 * const { session } = authResult
 * ```
 */
export async function requireUserAuth(): Promise<{ session: AuthSession } | NextResponse> {
    const session = await requireExistingSession()
    if (!session) {
        return unauthorized()
    }
    bindAuthLogContext(session)
    return { session }
}

/**
 * 验证项目权限（不要求项目工作流数据）
 * 适用于某些只需要项目基本信息的 API
 */
export async function requireProjectAuthLight(
    projectId: string
): Promise<{ session: AuthSession; project: { id: string; userId: string; name: string; [key: string]: unknown } } | NextResponse> {
    const session = await requireExistingSession()
    if (!session) {
        return unauthorized()
    }
    bindAuthLogContext(session, projectId)

    const project = await withRetry({
        operation: EXTERNAL_OPERATION.DATABASE_READ,
        scope: 'prisma:requireProjectAuthLight',
        run: async () => await prisma.project.findUnique({
            where: { id: projectId }
        }),
    })

    if (!project) {
        return notFound()
    }

    if (project.userId !== session.user.id) {
        return forbidden()
    }

    return { session, project }
}

// ============================================================
// 类型守卫
// ============================================================

/**
 * 检查是否是错误响应
 */
export function isErrorResponse(result: unknown): result is NextResponse {
    return result instanceof NextResponse
}
