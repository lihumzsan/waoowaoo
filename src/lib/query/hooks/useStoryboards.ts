'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { checkApiResponse } from '@/lib/error-handler'
import { resolveTaskErrorMessage } from '@/lib/task/error-message'
import { upsertTaskTargetOverlay } from '../task-target-overlay'
import type { MediaRef } from '@/types/project'
import { apiFetch } from '@/lib/api-fetch'
import { requireTaskSubmissionReceipt } from '@/lib/query/mutations/mutation-shared'

// ============ 类型定义 ============
export interface PanelCandidate {
    id: string
    imageUrl: string | null
    media?: MediaRef | null
    isSelected: boolean
    taskRunning: boolean
}

export interface StoryboardPanel {
    id: string
    shotId: string
    stageIndex: number
    shotIndex: number
    imageUrl: string | null
    media?: MediaRef | null
    motionPrompt: string | null
    videoUrl: string | null
    videoMedia?: MediaRef | null
    imageTaskRunning?: boolean
    videoTaskRunning?: boolean
    errorMessage: string | null
    candidates: PanelCandidate[]
    pendingCandidateCount: number
}

export interface StoryboardGroup {
    id: string
    stageIndex: number
    panels: StoryboardPanel[]
}

export interface StoryboardData {
    groups: StoryboardGroup[]
}

// ============ 查询 Hooks ============

/**
 * 获取分镜数据
 */
export function useStoryboards(projectId: string | null, episodeId: string | null) {
    return useQuery({
        queryKey: queryKeys.storyboards.all(episodeId || ''),
        queryFn: async () => {
            if (!projectId || !episodeId) throw new Error('Project ID and Episode ID are required')
            const res = await apiFetch(`/api/projects/${projectId}/storyboards?episodeId=${episodeId}`)
            if (!res.ok) throw new Error('Failed to fetch storyboards')
            const data = await res.json()
            return data as StoryboardData
        },
        enabled: !!projectId && !!episodeId,
    })
}

// ============ Mutation Hooks ============

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

export function usePlanBgmScore(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async () => {
            if (!projectId) throw new Error('Project ID is required')
            if (!episodeId) throw new Error('Episode ID is required')

            const res = await apiFetch(`/api/projects/${projectId}/plan-bgm-score`, {
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
                stage: 'bgm_score_prepare',
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

/**
 * 规划连续环境音效层（仅 LLM 文本任务）
 */
export function usePlanSoundscape(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async () => {
            if (!projectId) throw new Error('Project ID is required')
            if (!episodeId) throw new Error('Episode ID is required')

            const res = await apiFetch(`/api/projects/${projectId}/plan-soundscape`, {
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
                stage: 'soundscape_prepare',
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

/**
 * 选择分镜候选图
 */
export function useSelectPanelCandidate(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ panelId, candidateId }: { panelId: string; candidateId: string }) => {
            if (!projectId) throw new Error('Project ID is required')
            const res = await apiFetch(`/api/projects/${projectId}/panel/select-candidate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ panelId, candidateId }),
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error(resolveTaskErrorMessage(error, 'Failed to select candidate'))
            }
            return res.json()
        },
        onSettled: () => {
            if (episodeId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
            }
        },
    })
}

/**
 * 刷新分镜数据
 */
export function useRefreshStoryboards(episodeId: string | null) {
    const queryClient = useQueryClient()

    return () => {
        if (episodeId) {
            return queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
        }
        return Promise.resolve()
    }
}
