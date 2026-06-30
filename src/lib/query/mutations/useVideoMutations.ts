import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { invalidateQueryTemplates, requestJsonWithError } from './mutation-shared'

function invalidateVideoPanelCaches(
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

/**
 * 更新 Panel 视频提示词
 */
export function useUpdateProjectPanelVideoPrompt(projectId: string, episodeId?: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      storyboardId,
      panelIndex,
      value,
      field = 'videoPrompt',
    }: {
      storyboardId: string
      panelIndex: number
      value: string
      field?: 'imagePrompt' | 'videoPrompt'
    }) =>
      await requestJsonWithError(
        `/api/projects/${projectId}/panel`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyboardId,
            panelIndex,
            ...(field === 'imagePrompt'
              ? { imagePrompt: value }
              : { videoPrompt: value }),
          }),
        },
        'update failed',
      ),
    onSettled: () => {
      return invalidateVideoPanelCaches(queryClient, projectId, episodeId)
    },
  })
}
