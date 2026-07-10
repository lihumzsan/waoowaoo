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
            const confirmation = await mediaOperationBillingPlan('regenerate_panel_image', requestBody)
            const res = await apiFetch(`/api/projects/${projectId}/regenerate-panel-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...requestBody,
                    ...confirmation,
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
