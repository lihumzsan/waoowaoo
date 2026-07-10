'use client'

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { readProjectEditScriptJsonError } from '@/lib/query/project-edit-script-error'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import type { ProjectEditBible, ProjectEditChapter, ProjectEditScript, ProjectEditShotExecutionPlan } from '@/types/project'
import { upsertTaskTargetOverlay } from '../task-target-overlay'
import { queryKeys } from '../keys'
import { useMediaOperationBillingPlan } from '../use-media-operation-billing-plan'

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

export interface EditBibleResponse {
  editBible: ProjectEditBible | null
  chapters: ProjectEditChapter[]
}

interface EditShotExecutionPlanResponse {
  shotExecutionPlan: ProjectEditShotExecutionPlan | null
}

interface CreateEditScriptInput {
  episodeId: string
  videoRatio?: EditScriptVideoRatio
}

interface CreateEditBibleInput {
  episodeId: string
  text: string
  sourceKind: 'upload' | 'paste' | 'prompt_generated_outline'
  rawFileMediaId?: string
}

interface ConfirmEditBibleInput {
  episodeId: string
}

interface ReviseEditBibleInput {
  episodeId: string
  bible?: unknown
  beatSheet?: unknown
  ledger?: unknown
  emotionalCurve?: unknown
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
  bibleId?: string
  targetType?: string
  targetId?: string
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

async function fetchProjectEditBibleResponse(projectId: string, episodeId: string): Promise<EditBibleResponse> {
  const search = new URLSearchParams({ episodeId })
  const response = await apiFetch(`/api/projects/${projectId}/bible?${search.toString()}`)
  if (!response.ok) {
    throw await readJsonError(response, 'Failed to load edit bible')
  }
  const data = await response.json() as { editBible: ProjectEditBible | null; chapters?: ProjectEditChapter[] }
  return {
    editBible: data.editBible
      ? {
          ...data.editBible,
          chapters: data.chapters ?? [],
        }
      : null,
    chapters: data.chapters ?? [],
  }
}

export function projectEditBibleQueryOptions(projectId: string, episodeId: string) {
  return queryOptions({
    queryKey: queryKeys.project.editBible(projectId, episodeId),
    queryFn: async (): Promise<EditBibleResponse> => {
      if (!projectId || !episodeId) throw new Error('Project ID and episode ID are required')
      return await fetchProjectEditBibleResponse(projectId, episodeId)
    },
    staleTime: 5000,
  })
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

export function useProjectEditBible(projectId: string | null, episodeId: string | null) {
  return useQuery({
    ...projectEditBibleQueryOptions(projectId || '', episodeId || ''),
    select: (data) => data.editBible,
    enabled: Boolean(projectId && episodeId),
  })
}

export function useProjectEditBibleResponse(projectId: string | null, episodeId: string | null) {
  return useQuery({
    ...projectEditBibleQueryOptions(projectId || '', episodeId || ''),
    enabled: Boolean(projectId && episodeId),
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

export function useCreateProjectEditBible(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEditBibleInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/bible`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          episodeId: input.episodeId,
          sourceKind: input.sourceKind,
          text: input.text,
          ...(input.rawFileMediaId ? { rawFileMediaId: input.rawFileMediaId } : {}),
        }),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to generate edit bible')
      }
      const data = await response.json() as GenerateEditScriptTaskResponse
      if (data.async !== true || !data.taskId) throw new Error('EDIT_BIBLE_TASK_RESPONSE_EMPTY')
      return data
    },
    onSuccess: async (_result, variables) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editBible(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.context(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.pending(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.targetStatesAll(projectId), exact: false }),
      ])
    },
  })
}

export function useConfirmProjectEditBible(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ConfirmEditBibleInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/bible`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          episodeId: input.episodeId,
        }),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to confirm edit bible')
      }
      const data = await response.json() as { editBible?: ProjectEditBible | null }
      if (!data.editBible) throw new Error('EDIT_BIBLE_CONFIRM_RESPONSE_EMPTY')
      return data.editBible
    },
    onSuccess: async (editBible) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editBible(projectId, editBible.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, editBible.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.context(projectId, editBible.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, editBible.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
      ])
    },
  })
}

export function useReviseProjectEditBible(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ReviseEditBibleInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/bible`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'revise',
          episodeId: input.episodeId,
          ...(input.bible !== undefined ? { bible: input.bible } : {}),
          ...(input.beatSheet !== undefined ? { beatSheet: input.beatSheet } : {}),
          ...(input.ledger !== undefined ? { ledger: input.ledger } : {}),
          ...(input.emotionalCurve !== undefined ? { emotionalCurve: input.emotionalCurve } : {}),
        }),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to revise edit bible')
      }
      const data = await response.json() as EditBibleResponse
      if (!data.editBible) throw new Error('EDIT_BIBLE_REVISE_RESPONSE_EMPTY')
      return data.editBible
    },
    onSuccess: async (editBible) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editBible(projectId, editBible.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, editBible.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editShotExecutionPlan(projectId, editBible.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.context(projectId, editBible.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, editBible.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.pending(projectId, editBible.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.targetStatesAll(projectId), exact: false }),
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
  const mediaOperationBillingPlan = useMediaOperationBillingPlan(projectId)
  return useMutation({
    mutationFn: async (input: GenerateEditScriptAssetsInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const confirmation = await mediaOperationBillingPlan('generate_edit_script_assets', { ...input })
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/assets/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, ...confirmation }),
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
