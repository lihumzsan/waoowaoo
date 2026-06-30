'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { readProjectEditScriptJsonError } from '@/lib/query/project-edit-script-error'
import type { EditFirstDurationTier } from '@/lib/edit-script/duration-tier'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import type { ProjectEditScreenplay, ProjectEditScript, ProjectEditShotExecutionPlan } from '@/types/project'
import { upsertTaskTargetOverlay } from '../task-target-overlay'
import { queryKeys } from '../keys'

interface EditScriptResponse {
  editScript: ProjectEditScript | null
}

interface EditScriptAssetSubmittedTask {
  readonly taskId: string
  readonly taskType: string
  readonly targetType: 'CharacterAppearance' | 'LocationImage'
  readonly targetId: string
}

interface GenerateEditScriptAssetsResponse {
  readonly editScript: ProjectEditScript | null
  readonly submittedTasks?: readonly EditScriptAssetSubmittedTask[]
}

interface GenerateEditScriptAssetsMutationResult {
  readonly editScript: ProjectEditScript
  readonly submittedTasks: readonly EditScriptAssetSubmittedTask[]
}

interface EditScreenplayResponse {
  screenplay: ProjectEditScreenplay | null
}

interface EditShotExecutionPlanResponse {
  shotExecutionPlan: ProjectEditShotExecutionPlan | null
}

interface CreateEditScriptInput {
  episodeId: string
  screenplayId?: string
  videoRatio?: EditScriptVideoRatio
}

interface CreateEditScreenplayInput {
  episodeId: string
  prompt: string
  durationTier: EditFirstDurationTier
  aspectRatio: EditScriptVideoRatio
}

interface ConfirmEditStylePreviewInput {
  episodeId: string
  stylePreviewId: string
  aspectRatio: EditScriptVideoRatio
}

interface CreateEditShotExecutionPlanInput {
  episodeId: string
  editScriptId?: string
}

interface GenerateEditScriptAssetsInput {
  episodeId: string
  editScriptId?: string
  requirementId?: string
}

interface GenerateEditScriptStoryboardInput {
  episodeId: string
  editScriptId?: string
}

interface GenerateEditScriptStoryboardResponse {
  taskId?: string
  status?: string
  deduped?: boolean
}

interface GenerateEditScriptTaskResponse {
  success: boolean
  async: true
  taskId: string
  status?: string
  deduped?: boolean
  episodeId?: string
  screenplayId?: string
  targetType?: string
  targetId?: string
}

interface UpdateEditScriptGenerationSegmentContinuityInput {
  episodeId: string
  editScriptId: string
  segmentIndex: number
  continuity: string
}

interface MergeEditScriptGenerationSegmentsInput {
  episodeId: string
  editScriptId: string
  leftSegmentIndex: number
  rightSegmentIndex: number
}

interface ArrangeEditScriptGenerationSegmentsInput {
  episodeId: string
  editScriptId: string
  segments: readonly {
    readonly shotNumbers: readonly number[]
    readonly continuity: string
  }[]
}

interface UpdateEditAssetRequirementDescriptionInput {
  episodeId: string
  editScriptId: string
  requirementId: string
  description: string
}

async function readJsonError(response: Response, fallback: string): Promise<Error> {
  return await readProjectEditScriptJsonError(response, fallback)
}

export function useProjectEditScript(projectId: string | null, episodeId: string | null) {
  return useQuery({
    queryKey: queryKeys.project.editScript(projectId || '', episodeId || ''),
    queryFn: async () => {
      if (!projectId || !episodeId) throw new Error('Project ID and episode ID are required')
      const search = new URLSearchParams({ episodeId })
      const response = await apiFetch(`/api/projects/${projectId}/edit-script?${search.toString()}`)
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to load edit script')
      }
      const data = await response.json() as EditScriptResponse
      return data.editScript
    },
    enabled: Boolean(projectId && episodeId),
    staleTime: 5000,
  })
}

export function useProjectEditScreenplay(projectId: string | null, episodeId: string | null) {
  return useQuery({
    queryKey: queryKeys.project.editScreenplay(projectId || '', episodeId || ''),
    queryFn: async () => {
      if (!projectId || !episodeId) throw new Error('Project ID and episode ID are required')
      const search = new URLSearchParams({ episodeId })
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/screenplay?${search.toString()}`)
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to load edit screenplay')
      }
      const data = await response.json() as EditScreenplayResponse
      return data.screenplay
    },
    enabled: Boolean(projectId && episodeId),
    staleTime: 5000,
  })
}

export function useProjectEditShotExecutionPlan(projectId: string | null, episodeId: string | null) {
  return useQuery({
    queryKey: queryKeys.project.editShotExecutionPlan(projectId || '', episodeId || ''),
    queryFn: async () => {
      if (!projectId || !episodeId) throw new Error('Project ID and episode ID are required')
      const search = new URLSearchParams({ episodeId })
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/shot-execution-plan?${search.toString()}`)
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to load shot execution plan')
      }
      const data = await response.json() as EditShotExecutionPlanResponse
      return data.shotExecutionPlan
    },
    enabled: Boolean(projectId && episodeId),
    staleTime: 5000,
  })
}

export function useCreateProjectEditScript(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEditScriptInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to generate edit script')
      }
      const data = await response.json() as GenerateEditScriptTaskResponse
      if (data.async !== true || !data.taskId) throw new Error('EDIT_SCRIPT_TASK_RESPONSE_EMPTY')
      return data
    },
    onSuccess: async (_result, variables) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.context(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.pending(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.targetStatesAll(projectId), exact: false }),
      ])
    },
  })
}

export function useCreateProjectEditScreenplay(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEditScreenplayInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/screenplay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to generate edit screenplay')
      }
      const data = await response.json() as GenerateEditScriptTaskResponse
      if (data.async !== true || !data.taskId) throw new Error('EDIT_SCREENPLAY_TASK_RESPONSE_EMPTY')
      return data
    },
    onSuccess: async (_result, variables) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScreenplay(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.context(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.pending(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.targetStatesAll(projectId), exact: false }),
      ])
    },
  })
}

export function useConfirmProjectEditStylePreview(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ConfirmEditStylePreviewInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/screenplay`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to confirm edit style preview')
      }
      const data = await response.json() as EditScreenplayResponse
      if (!data.screenplay) throw new Error('EDIT_SCREENPLAY_RESPONSE_EMPTY')
      return data.screenplay
    },
    onSuccess: async (screenplay) => {
      if (!projectId) return
      queryClient.setQueryData(queryKeys.project.editScreenplay(projectId, screenplay.episodeId), screenplay)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScreenplay(projectId, screenplay.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, screenplay.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editShotExecutionPlan(projectId, screenplay.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.context(projectId, screenplay.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, screenplay.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
      ])
    },
  })
}

export function useCreateProjectEditShotExecutionPlan(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEditShotExecutionPlanInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/shot-execution-plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to generate shot execution plan')
      }
      const data = await response.json() as GenerateEditScriptTaskResponse
      if (data.async !== true || !data.taskId) throw new Error('EDIT_SHOT_EXECUTION_PLAN_TASK_RESPONSE_EMPTY')
      return data
    },
    onSuccess: async (_result, variables) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editShotExecutionPlan(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.context(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.pending(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.targetStatesAll(projectId), exact: false }),
      ])
    },
  })
}

export function useGenerateProjectEditScriptAssets(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: GenerateEditScriptAssetsInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/assets/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to generate required assets')
      }
      const data = await response.json() as GenerateEditScriptAssetsResponse
      if (!data.editScript) throw new Error('EDIT_SCRIPT_RESPONSE_EMPTY')
      return {
        editScript: data.editScript,
        submittedTasks: data.submittedTasks ?? [],
      } satisfies GenerateEditScriptAssetsMutationResult
    },
    onSuccess: async ({ editScript, submittedTasks }) => {
      if (!projectId) return
      queryClient.setQueryData(queryKeys.project.editScript(projectId, editScript.episodeId), editScript)
      submittedTasks.forEach((task) => {
        upsertTaskTargetOverlay(queryClient, {
          projectId,
          targetType: task.targetType,
          targetId: task.targetId,
          runningTaskId: task.taskId,
          runningTaskType: task.taskType,
          intent: 'generate',
        })
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, editScript.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.context(projectId, editScript.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, editScript.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.assets.all('project', projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.pending(projectId, editScript.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.targetStatesAll(projectId), exact: false }),
      ])
    },
  })
}

export function useGenerateProjectEditScriptStoryboard(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: GenerateEditScriptStoryboardInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/storyboard/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to generate storyboard')
      }
      return await response.json() as GenerateEditScriptStoryboardResponse
    },
    onSuccess: async (_result, variables) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.context(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.pending(projectId, variables.episodeId) }),
      ])
    },
  })
}

export function useUpdateProjectEditScriptGenerationSegmentContinuity(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateEditScriptGenerationSegmentContinuityInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to update generation segment continuity')
      }
      const data = await response.json() as EditScriptResponse
      if (!data.editScript) throw new Error('EDIT_SCRIPT_RESPONSE_EMPTY')
      return data.editScript
    },
    onSuccess: async (editScript) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, editScript.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, editScript.episodeId) }),
      ])
    },
  })
}

export function useMergeProjectEditScriptGenerationSegments(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: MergeEditScriptGenerationSegmentsInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'mergeGenerationSegments',
          ...input,
        }),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to merge video segments')
      }
      const data = await response.json() as EditScriptResponse
      if (!data.editScript) throw new Error('EDIT_SCRIPT_RESPONSE_EMPTY')
      return data.editScript
    },
    onSuccess: async (editScript) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, editScript.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, editScript.episodeId) }),
      ])
    },
  })
}

export function useArrangeProjectEditScriptGenerationSegments(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ArrangeEditScriptGenerationSegmentsInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'arrangeGenerationSegments',
          ...input,
        }),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to arrange video segments')
      }
      const data = await response.json() as EditScriptResponse
      if (!data.editScript) throw new Error('EDIT_SCRIPT_RESPONSE_EMPTY')
      return data.editScript
    },
    onSuccess: async (editScript) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, editScript.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, editScript.episodeId) }),
      ])
    },
  })
}

export function useUpdateProjectEditScriptAssetRequirementDescription(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateEditAssetRequirementDescriptionInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to update required asset prompt')
      }
      const data = await response.json() as EditScriptResponse
      if (!data.editScript) throw new Error('EDIT_SCRIPT_RESPONSE_EMPTY')
      return data.editScript
    },
    onSuccess: async (editScript) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, editScript.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, editScript.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
      ])
    },
  })
}
