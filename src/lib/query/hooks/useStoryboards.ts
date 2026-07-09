'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { checkApiResponse } from '@/lib/error-handler'
import { resolveTaskErrorMessage } from '@/lib/task/error-message'
import { clearTaskTargetOverlay, upsertTaskTargetOverlay } from '../task-target-overlay'
import type { MediaRef } from '@/types/project'
import { apiFetch } from '@/lib/api-fetch'
import { useMediaOperationBillingPlan } from '../use-media-operation-billing-plan'
import {
    buildBatchVideoGenerationPlanRequest,
    type VideoGenerationOptions,
} from '../media-operation-plan-input'

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

interface BatchVideoGenerationParams {
    generationOptions?: VideoGenerationOptions
    mode?: 'single' | 'grid' | 'auto' | 'asset-reference'
    gridMode?: '2x2' | '3x3'
    shotIds?: readonly string[]
    segmentIndex?: number
    referenceImageUrls?: readonly string[]
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
 * 重新生成分镜图片
 */
export function useRegeneratePanelImage(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()
    const mediaOperationBillingPlan = useMediaOperationBillingPlan(projectId, episodeId)

    return useMutation({
        mutationFn: async ({ panelId }: { panelId: string }) => {
            if (!projectId) throw new Error('Project ID is required')
            const requestBody = { panelId }
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
                const error = await res.json()
                throw new Error(resolveTaskErrorMessage(error, 'Failed to regenerate'))
            }
            return res.json()
        },
        onMutate: async () => {
            if (!projectId) return
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
        },
        onSettled: () => {
            if (episodeId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
            }
        },
    })
}

/**
 * 生成视频
 */
export function useGenerateVideo(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()
    const mediaOperationBillingPlan = useMediaOperationBillingPlan(projectId, episodeId)

    return useMutation({
        mutationFn: async (params: {
            storyboardId: string
            panelIndex: number
            panelId?: string
            generationOptions?: VideoGenerationOptions
        }) => {
            if (!projectId) throw new Error('Project ID is required')

            // 构建请求体
            const requestBody: {
                storyboardId: string
                panelIndex: number
                panelId?: string
                generationOptions?: VideoGenerationOptions
            } = {
                storyboardId: params.storyboardId,
                panelIndex: params.panelIndex,
            }
            if (params.panelId) {
                requestBody.panelId = params.panelId
            }

            if (params.generationOptions && typeof params.generationOptions === 'object') {
                requestBody.generationOptions = params.generationOptions
            }

            const confirmedMaxCost = await mediaOperationBillingPlan('generate_panel_video', {
                ...requestBody,
            })
            const res = await apiFetch(`/api/projects/${projectId}/generate-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...requestBody,
                    ...(confirmedMaxCost !== null ? { confirmedMaxCost } : {}),
                }),
            })
            // 🔥 使用统一错误处理
            await checkApiResponse(res)
            return res.json()
        },
        onMutate: async ({ panelId }) => {
            if (!projectId) return
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
            if (!panelId) return
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectPanel',
                targetId: panelId,
                intent: 'generate',
            })
        },
        onError: (_error, { panelId }) => {
            if (!projectId || !panelId) return
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectPanel',
                targetId: panelId,
            })
        },
        onSettled: () => {
            // 🔥 刷新缓存获取最新状态
            if (episodeId && projectId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
                queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
            }
        },
    })
}

/**
 * 批量生成视频
 *
 * 后端为每个需要生成的 panel 创建独立的 Panel 级任务，
 * 与单个生成走完全相同的 SSE → overlay → UI 流程。
 */
export function useBatchGenerateVideos(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()
    const mediaOperationBillingPlan = useMediaOperationBillingPlan(projectId, episodeId)

    return useMutation({
        mutationFn: async (params: BatchVideoGenerationParams) => {
            if (!projectId) throw new Error('Project ID is required')
            if (!episodeId) throw new Error('Episode ID is required')

            const request = buildBatchVideoGenerationPlanRequest({
                episodeId,
                generationOptions: params.generationOptions,
                mode: params.mode,
                gridMode: params.gridMode,
                shotIds: params.shotIds,
                segmentIndex: params.segmentIndex,
                referenceImageUrls: params.referenceImageUrls,
            })
            const confirmedMaxCost = await mediaOperationBillingPlan(request.operationId, request.input)
            const res = await apiFetch(`/api/projects/${projectId}/generate-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...request.input,
                    ...(confirmedMaxCost !== null ? { confirmedMaxCost } : {}),
                }),
            })
            // 🔥 使用统一错误处理
            await checkApiResponse(res)
            return res.json()
        },
        onMutate: async () => {
            if (!projectId) return
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
        },
        onSettled: () => {
            // 🔥 刷新缓存获取最新状态
            if (episodeId && projectId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
                queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
            }
        },
    })
}

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
                    confirmed: true,
                    episodeId,
                }),
            })
            await checkApiResponse(res)
            return res.json()
        },
        onMutate: async () => {
            if (!projectId || !episodeId) return
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectEpisode',
                targetId: episodeId,
                runningTaskType: 'final_video_render',
                intent: 'process',
                stage: 'final_render_prepare',
            })
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
        },
        onError: () => {
            if (!projectId || !episodeId) return
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectEpisode',
                targetId: episodeId,
            })
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
 * 生成连续 BGM 多音轨工程
 */
export function useGenerateBgmScore(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()
    const mediaOperationBillingPlan = useMediaOperationBillingPlan(projectId, episodeId)

    return useMutation({
        mutationFn: async () => {
            if (!projectId) throw new Error('Project ID is required')
            if (!episodeId) throw new Error('Episode ID is required')

            const requestBody = { episodeId }
            const confirmedMaxCost = await mediaOperationBillingPlan('generate_episode_bgm_score', requestBody)
            const res = await apiFetch(`/api/projects/${projectId}/generate-bgm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    confirmed: true,
                    ...requestBody,
                    ...(confirmedMaxCost !== null ? { confirmedMaxCost } : {}),
                }),
            })
            await checkApiResponse(res)
            return res.json()
        },
        onMutate: async () => {
            if (!projectId || !episodeId) return
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectEpisode',
                targetId: episodeId,
                runningTaskType: 'music_score_plan',
                intent: 'generate',
                stage: 'bgm_score_prepare',
            })
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
        },
        onError: () => {
            if (!projectId || !episodeId) return
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectEpisode',
                targetId: episodeId,
            })
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
 * 生成连续环境音效层
 */
export function useGenerateSoundscape(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()
    const mediaOperationBillingPlan = useMediaOperationBillingPlan(projectId, episodeId)

    return useMutation({
        mutationFn: async () => {
            if (!projectId) throw new Error('Project ID is required')
            if (!episodeId) throw new Error('Episode ID is required')

            const requestBody = { episodeId }
            const confirmedMaxCost = await mediaOperationBillingPlan('generate_episode_soundscape', requestBody)
            const res = await apiFetch(`/api/projects/${projectId}/generate-soundscape`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    confirmed: true,
                    ...requestBody,
                    ...(confirmedMaxCost !== null ? { confirmedMaxCost } : {}),
                }),
            })
            await checkApiResponse(res)
            return res.json()
        },
        onMutate: async () => {
            if (!projectId || !episodeId) return
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectEpisode',
                targetId: episodeId,
                runningTaskType: 'soundscape_plan',
                intent: 'generate',
                stage: 'soundscape_prepare',
            })
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
        },
        onError: () => {
            if (!projectId || !episodeId) return
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'ProjectEpisode',
                targetId: episodeId,
            })
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
