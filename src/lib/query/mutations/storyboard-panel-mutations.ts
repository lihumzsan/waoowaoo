import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { resolveTaskErrorMessage } from '@/lib/task/error-message'
import { apiFetch } from '@/lib/api-fetch'
import { TASK_TYPE } from '@/lib/task/types'
import {
    clearTaskTargetOverlay,
    upsertTaskTargetOverlay,
} from '../task-target-overlay'
import {
    invalidateQueryTemplates,
    requestJsonWithError,
} from './mutation-shared'
import { useMediaOperationBillingPlan } from '../use-media-operation-billing-plan'

function invalidateStoryboardMutationCaches(
    queryClient: ReturnType<typeof useQueryClient>,
    projectId: string,
    episodeId?: string | null,
) {
    const queryTemplates: Array<readonly unknown[]> = [
        queryKeys.projectAssets.all(projectId),
        queryKeys.projectData(projectId),
    ]
    if (episodeId) {
        queryTemplates.push(queryKeys.episodeData(projectId, episodeId))
        queryTemplates.push(queryKeys.storyboards.all(episodeId))
    }
    return invalidateQueryTemplates(queryClient, queryTemplates)
}

export function useRegenerateProjectPanelImage(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    const mediaOperationBillingPlan = useMediaOperationBillingPlan(projectId, episodeId)
    return useMutation({
        mutationFn: async ({
            panelId,
            count,
            referenceMode,
            referencePanelIds,
            extraImageUrls,
            referenceImageNotes,
        }: {
            panelId: string
            count?: number
            referenceMode?: 'asset' | 'storyboard'
            referencePanelIds?: string[]
            extraImageUrls?: string[]
            referenceImageNotes?: unknown[]
        }) => {
            const requestBody = {
                panelId,
                count: count ?? 1,
                ...(referenceMode ? { referenceMode } : {}),
                ...(referencePanelIds && referencePanelIds.length > 0 ? { referencePanelIds } : {}),
                ...(extraImageUrls && extraImageUrls.length > 0 ? { extraImageUrls } : {}),
                ...(referenceImageNotes && referenceImageNotes.length > 0 ? { referenceImageNotes } : {}),
            }
            const confirmedMaxCost = await mediaOperationBillingPlan('regenerate_panel_image', requestBody)
            const res = await apiFetch(`/api/projects/${projectId}/regenerate-panel-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...requestBody,
                    ...(confirmedMaxCost !== null ? { confirmedMaxCost } : {}),
                }),
            })
            if (!res.ok) {
                const error = await res.json().catch(() => ({}))
                if (res.status === 402) throw new Error('额度不足，请获取额度后继续使用')
                if (res.status === 400 && String(error?.error || '').includes('敏感')) {
                    throw new Error(resolveTaskErrorMessage(error, '提示词包含敏感内容'))
                }
                if (res.status === 429 || error?.code === 'RATE_LIMIT') {
                    const retryAfter = error?.retryAfter || 60
                    throw new Error(`API 配额超限，请等待 ${retryAfter} 秒后重试`)
                }
                throw new Error(resolveTaskErrorMessage(error, '重新生成失败'))
            }
            return res.json()
        },
        onMutate: ({ panelId }) => {
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectPanel',
                targetId: panelId,
                runningTaskType: TASK_TYPE.IMAGE_PANEL,
                intent: 'regenerate',
            })
        },
        onSuccess: (payload, { panelId }) => {
            const record = payload && typeof payload === 'object' && !Array.isArray(payload)
                ? payload as Record<string, unknown>
                : {}
            const taskId = typeof record.taskId === 'string' ? record.taskId : null
            if (taskId) {
                upsertTaskTargetOverlay(queryClient, {
                    projectId,
                    targetType: 'ProjectPanel',
                    targetId: panelId,
                    runningTaskId: taskId,
                    runningTaskType: TASK_TYPE.IMAGE_PANEL,
                    intent: 'regenerate',
                })
            }
            queryClient.invalidateQueries({
                queryKey: queryKeys.tasks.targetStatesAll(projectId),
                exact: false,
            })
        },
        onError: (_error, { panelId }) => {
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectPanel',
                targetId: panelId,
            })
        },
        onSettled: () => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tasks.targetStatesAll(projectId),
                exact: false,
            })
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

export function useGenerateStoryboardGridImages(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    const mediaOperationBillingPlan = useMediaOperationBillingPlan(projectId, episodeId)
    return useMutation({
        mutationFn: async (payload: {
            episodeId: string
            editScriptId: string
            sourceVideoBlockId: string
            panelIds: readonly string[]
        }) => {
            const confirmedMaxCost = await mediaOperationBillingPlan('generate_storyboard_grid_images', {
                episodeId: payload.episodeId,
                editScriptId: payload.editScriptId,
                sourceVideoBlockId: payload.sourceVideoBlockId,
                panelIds: [...payload.panelIds],
            })
            const res = await apiFetch(`/api/projects/${projectId}/edit-script/storyboard/images/block-grid/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payload,
                    ...(confirmedMaxCost !== null ? { confirmedMaxCost } : {}),
                }),
            })
            if (!res.ok) {
                const error = await res.json().catch(() => ({}))
                if (res.status === 402) throw new Error('额度不足，请获取额度后继续使用')
                if (res.status === 429 || error?.code === 'RATE_LIMIT') {
                    const retryAfter = error?.retryAfter || 60
                    throw new Error(`API 配额超限，请等待 ${retryAfter} 秒后重试`)
                }
                throw new Error(resolveTaskErrorMessage(error, '四宫格分镜生成失败'))
            }
            return res.json()
        },
        onMutate: ({ panelIds }) => {
            for (const panelId of panelIds) {
                upsertTaskTargetOverlay(queryClient, {
                    projectId,
                    targetType: 'ProjectPanel',
                    targetId: panelId,
                    runningTaskType: TASK_TYPE.IMAGE_PANEL,
                    intent: 'regenerate',
                })
            }
        },
        onSuccess: (payload, { panelIds }) => {
            const record = payload && typeof payload === 'object' && !Array.isArray(payload)
                ? payload as Record<string, unknown>
                : {}
            const taskId = typeof record.taskId === 'string' ? record.taskId : null
            if (taskId) {
                for (const panelId of panelIds) {
                    upsertTaskTargetOverlay(queryClient, {
                        projectId,
                        targetType: 'ProjectPanel',
                        targetId: panelId,
                        runningTaskId: taskId,
                        runningTaskType: TASK_TYPE.IMAGE_PANEL,
                        intent: 'regenerate',
                    })
                }
            }
            queryClient.invalidateQueries({
                queryKey: queryKeys.tasks.targetStatesAll(projectId),
                exact: false,
            })
        },
        onError: (_error, { panelIds }) => {
            for (const panelId of panelIds) {
                clearTaskTargetOverlay(queryClient, {
                    projectId,
                    targetType: 'ProjectPanel',
                    targetId: panelId,
                })
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tasks.targetStatesAll(projectId),
                exact: false,
            })
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 修改镜头图片（storyboard）
 */

export function useModifyProjectStoryboardImage(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: {
            storyboardId: string
            panelIndex: number
            modifyPrompt: string
            extraImageUrls: string[]
            selectedAssets: Array<{
                id: string
                name: string
                type: 'character' | 'location'
                imageUrl: string | null
                appearanceId?: number
                appearanceName?: string
            }>
        }) => {
            return await requestJsonWithError(`/api/projects/${projectId}/modify-storyboard-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '修改失败')
        },
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 下载剧集全部图片（zip）
 */

export function useDownloadProjectImages(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }) => {
            const response = await apiFetch(`/api/projects/${projectId}/download-images?episodeId=${episodeId}`)
            if (!response.ok) {
                const error = await response.json().catch(() => ({}))
                throw new Error(resolveTaskErrorMessage(error, '下载失败'))
            }
            return response.blob()
        },
    })
}

export function useRevertProjectPanelImage(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ panelId }: { panelId: string }) =>
            await requestJsonWithError(
                `/api/projects/${projectId}/panel/revert-image`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ panelId }),
                },
                'IMAGE_REVERT_FAILED',
            ),
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 更新分镜 panel
 */

export function useUpdateProjectPanel(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (payload: Record<string, unknown>) =>
            await requestJsonWithError(
                `/api/projects/${projectId}/panel`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                '保存失败',
            ),
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 选择/取消镜头候选图（项目）
 */

export function useCreateProjectPanel(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: Record<string, unknown>) => {
            return await requestJsonWithError(`/api/projects/${projectId}/panel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '添加失败')
        },
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 删除 panel
 */

export function useDeleteProjectPanel(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ panelId }: { panelId: string }) => {
            return await requestJsonWithError(`/api/projects/${projectId}/panel?panelId=${panelId}`, {
                method: 'DELETE',
            }, '删除失败')
        },
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 复制 panel
 */

export function useCopyProjectPanel(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: {
            sourcePanelId: string
            insertAfterPanelId?: string
            includeImages?: boolean
        }) => {
            return await requestJsonWithError(`/api/projects/${projectId}/panel/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '复制失败')
        },
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 删除 storyboard group
 */

export function useDeleteProjectStoryboardGroup(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ storyboardId }: { storyboardId: string }) => {
            return await requestJsonWithError(
                `/api/projects/${projectId}/storyboard-group?storyboardId=${storyboardId}`,
                { method: 'DELETE' },
                '删除失败',
            )
        },
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 新增 storyboard group
 */

export function useCreateProjectStoryboardGroup(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: { episodeId: string; insertIndex: number }) => {
            return await requestJsonWithError(`/api/projects/${projectId}/storyboard-group`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '添加失败')
        },
        onSettled: (_data, _error, variables) => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, variables.episodeId)
        },
    })
}

/**
 * 复制 storyboard group
 */

export function useCopyProjectStoryboardGroup(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: {
            sourceStoryboardId: string
            insertIndex: number
            includeImages?: boolean
        }) => {
            return await requestJsonWithError(`/api/projects/${projectId}/storyboard-group/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '复制失败')
        },
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 移动 storyboard group
 */

export function useMoveProjectStoryboardGroup(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: { episodeId: string; storyboardId: string; direction: 'up' | 'down' }) => {
            return await requestJsonWithError(`/api/projects/${projectId}/storyboard-group`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '移动失败')
        },
        onSettled: (_data, _error, variables) => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, variables.episodeId)
        },
    })
}

/**
 * 插入 panel（异步）
 */

export function useInsertProjectPanel(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: { storyboardId: string; insertAfterPanelId: string; userInput: string }) => {
            return await requestJsonWithError(`/api/projects/${projectId}/insert-panel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '插入分镜失败')
        },
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 生成镜头变体（异步）
 */

export function useCreateProjectPanelVariant(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    const mediaOperationBillingPlan = useMediaOperationBillingPlan(projectId, episodeId)
    return useMutation({
        mutationFn: async (payload: {
            storyboardId: string
            insertAfterPanelId: string
            sourcePanelId: string
            variant: {
                title: string
                description: string
                shot_type: string
                camera_move: string
                video_prompt: string
            }
            includeCharacterAssets: boolean
            includeLocationAsset: boolean
        }) => {
            const confirmedMaxCost = await mediaOperationBillingPlan('panel_variant', {
                storyboardId: payload.storyboardId,
                insertAfterPanelId: payload.insertAfterPanelId,
                sourcePanelId: payload.sourcePanelId,
                variant: payload.variant,
            })
            return await requestJsonWithError<{ panelId: string }>(`/api/projects/${projectId}/panel-variant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payload,
                    ...(confirmedMaxCost !== null ? { confirmedMaxCost } : {}),
                }),
            }, '生成变体失败')
        },
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 清除 storyboard 错误
 */
export function useClearProjectStoryboardError(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ storyboardId }: { storyboardId: string }) =>
            await requestJsonWithError(
                `/api/projects/${projectId}/storyboards`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storyboardId }),
                },
                '清除分镜错误失败',
            ),
        onSettled: () => {
            return invalidateStoryboardMutationCaches(queryClient, projectId, episodeId)
        },
    })
}
