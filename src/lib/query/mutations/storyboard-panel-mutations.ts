import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import {
    invalidateQueryTemplates,
    requestJsonWithError,
} from './mutation-shared'

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
