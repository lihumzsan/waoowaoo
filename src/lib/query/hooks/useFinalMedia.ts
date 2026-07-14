'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { checkApiResponse } from '@/lib/error-handler'
import { upsertTaskTargetOverlay } from '../task-target-overlay'
import { apiFetch } from '@/lib/api-fetch'
import { requireTaskSubmissionReceipt } from '@/lib/query/mutations/mutation-shared'

/**
 * AI 剪辑成片
 */
export function useRenderFinalVideo(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async () => {
            if (!projectId) throw new Error('Project ID is required')
            if (!episodeId) throw new Error('Episode ID is required')

            const res = await apiFetch(`/api/projects/${projectId}/final-video-render`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    episodeId,
                }),
            })
            await checkApiResponse(res)
            return requireTaskSubmissionReceipt(await res.json())
        },
        onSuccess: async (receipt) => {
            if (!projectId || !episodeId) return
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectEpisode',
                targetId: episodeId,
                runningTaskId: receipt.taskId,
                runningTaskType: receipt.taskType,
                intent: 'process',
                stage: 'final_render_prepare',
            })
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
        },
        onSettled: () => {
            if (episodeId && projectId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
                queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
            }
        },
    })
}

export function usePlanAudioDesign(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async () => {
            if (!projectId) throw new Error('Project ID is required')
            if (!episodeId) throw new Error('Episode ID is required')

            const res = await apiFetch(`/api/projects/${projectId}/plan-audio-design`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ episodeId }),
            })
            await checkApiResponse(res)
            return requireTaskSubmissionReceipt(await res.json())
        },
        onSuccess: async (receipt) => {
            if (!projectId || !episodeId) return
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectEpisode',
                targetId: episodeId,
                runningTaskId: receipt.taskId,
                runningTaskType: receipt.taskType,
                intent: 'generate',
                stage: 'audio_design_prepare',
            })
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
        },
        onSettled: () => {
            if (episodeId && projectId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
                queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
            }
        },
    })
}
