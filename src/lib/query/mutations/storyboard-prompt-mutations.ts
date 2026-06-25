import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import {
  invalidateQueryTemplates,
  requestJsonWithError,
} from './mutation-shared'

/**
 * 更新摄影规则（项目）
 */

function invalidateStoryboardPromptCaches(
    queryClient: ReturnType<typeof useQueryClient>,
    projectId: string,
    episodeId?: string | null,
) {
    const queryTemplates: Array<readonly unknown[]> = [queryKeys.projectData(projectId)]
    if (episodeId) {
        queryTemplates.push(queryKeys.episodeData(projectId, episodeId))
        queryTemplates.push(queryKeys.storyboards.all(episodeId))
    }
    return invalidateQueryTemplates(queryClient, queryTemplates)
}

export function useUpdateProjectPhotographyPlan(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: {
            storyboardId: string
            photographyPlan: string
        }) =>
            await requestJsonWithError(
                `/api/projects/${projectId}/photography-plan`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                '保存摄影规则失败',
            ),
        onSettled: () => {
            return invalidateStoryboardPromptCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 更新镜头演技指导（项目）
 */

export function useUpdateProjectPanelActingNotes(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: {
            storyboardId: string
            panelIndex: number
            actingNotes: string
        }) =>
            await requestJsonWithError(
                `/api/projects/${projectId}/panel`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                '保存演技指导失败',
            ),
        onSettled: () => {
            return invalidateStoryboardPromptCaches(queryClient, projectId, episodeId)
        },
    })
}

/**
 * 选择/取消镜头候选图（项目）
 */

export function useSelectProjectPanelCandidate(projectId: string, episodeId?: string | null) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [
            queryKeys.projectAssets.all(projectId),
            queryKeys.projectData(projectId),
            ...(episodeId
                ? [
                    queryKeys.episodeData(projectId, episodeId),
                    queryKeys.storyboards.all(episodeId),
                ]
                : []),
        ])

    return useMutation({
        mutationFn: async (payload: {
            panelId: string
            action: 'select' | 'cancel'
            selectedImageUrl?: string
        }) =>
            await requestJsonWithError(
                `/api/projects/${projectId}/panel/select-candidate`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'Failed to select panel candidate',
            ),
        onSuccess: invalidateProjectAssets,
    })
}
