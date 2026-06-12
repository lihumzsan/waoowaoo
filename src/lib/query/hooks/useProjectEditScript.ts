'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { readProjectEditScriptJsonError } from '@/lib/query/project-edit-script-error'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import type { ProjectEditCinematographyShotPlan, ProjectEditDirectorDecoupage, ProjectEditScreenplay, ProjectEditScript } from '@/types/project'
import { queryKeys } from '../keys'

interface EditScriptResponse {
  editScript: ProjectEditScript | null
}

interface EditScreenplayResponse {
  screenplay: ProjectEditScreenplay | null
}

interface EditDirectorDecoupageResponse {
  directorDecoupage: ProjectEditDirectorDecoupage | null
}

interface EditCinematographyShotPlanResponse {
  cinematographyShotPlan: ProjectEditCinematographyShotPlan | null
}

interface CreateEditScriptInput {
  episodeId: string
  screenplayId?: string
  videoRatio?: EditScriptVideoRatio
}

interface CreateEditScreenplayInput {
  episodeId: string
  prompt: string
}

interface ConfirmEditStylePreviewInput {
  episodeId: string
  stylePreviewId: string
  aspectRatio: EditScriptVideoRatio
}

interface CreateEditDirectorDecoupageInput {
  episodeId: string
  screenplayId?: string
}

interface CreateEditCinematographyShotPlanInput {
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
}

interface UpdateEditScriptVideoBlockPromptInput {
  episodeId: string
  editScriptId: string
  blockIndex: number
  prompt: string
}

interface MergeEditScriptVideoBlocksInput {
  episodeId: string
  editScriptId: string
  leftBlockIndex: number
  rightBlockIndex: number
}

interface ArrangeEditScriptVideoBlocksInput {
  episodeId: string
  editScriptId: string
  blocks: readonly {
    readonly shotNumbers: readonly number[]
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

export function useProjectEditDirectorDecoupage(projectId: string | null, episodeId: string | null) {
  return useQuery({
    queryKey: queryKeys.project.editDirectorDecoupage(projectId || '', episodeId || ''),
    queryFn: async () => {
      if (!projectId || !episodeId) throw new Error('Project ID and episode ID are required')
      const search = new URLSearchParams({ episodeId })
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/director-decoupage?${search.toString()}`)
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to load director decoupage')
      }
      const data = await response.json() as EditDirectorDecoupageResponse
      return data.directorDecoupage
    },
    enabled: Boolean(projectId && episodeId),
    staleTime: 5000,
  })
}

export function useProjectEditCinematographyShotPlan(projectId: string | null, episodeId: string | null) {
  return useQuery({
    queryKey: queryKeys.project.editCinematographyShotPlan(projectId || '', episodeId || ''),
    queryFn: async () => {
      if (!projectId || !episodeId) throw new Error('Project ID and episode ID are required')
      const search = new URLSearchParams({ episodeId })
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/cinematography-shot-plan?${search.toString()}`)
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to load cinematography shot plan')
      }
      const data = await response.json() as EditCinematographyShotPlanResponse
      return data.cinematographyShotPlan
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
      const data = await response.json() as EditScreenplayResponse
      if (!data.screenplay) throw new Error('EDIT_SCREENPLAY_RESPONSE_EMPTY')
      return data.screenplay
    },
    onSuccess: async (screenplay) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScreenplay(projectId, screenplay.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, screenplay.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, screenplay.episodeId) }),
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
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editDirectorDecoupage(projectId, screenplay.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editScript(projectId, screenplay.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, screenplay.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
      ])
    },
  })
}

export function useCreateProjectEditDirectorDecoupage(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEditDirectorDecoupageInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/director-decoupage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to generate director decoupage')
      }
      const data = await response.json() as EditDirectorDecoupageResponse
      if (!data.directorDecoupage) throw new Error('EDIT_DIRECTOR_DECOUPAGE_RESPONSE_EMPTY')
      return data.directorDecoupage
    },
    onSuccess: async (directorDecoupage) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editDirectorDecoupage(projectId, directorDecoupage.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, directorDecoupage.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
      ])
    },
  })
}

export function useCreateProjectEditCinematographyShotPlan(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEditCinematographyShotPlanInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/cinematography-shot-plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to generate cinematography shot plan')
      }
      const data = await response.json() as EditCinematographyShotPlanResponse
      if (!data.cinematographyShotPlan) throw new Error('EDIT_CINEMATOGRAPHY_SHOT_PLAN_RESPONSE_EMPTY')
      return data.cinematographyShotPlan
    },
    onSuccess: async (shotPlan) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project.editCinematographyShotPlan(projectId, shotPlan.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, shotPlan.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
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
        queryClient.invalidateQueries({ queryKey: queryKeys.assets.all('project', projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.pending(projectId, editScript.episodeId) }),
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
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.pending(projectId, variables.episodeId) }),
      ])
    },
  })
}

export function useGenerateProjectEditScriptStoryboardSpatialBlocking(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: GenerateEditScriptStoryboardInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script/storyboard/spatial-blocking/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to generate storyboard spatial blocking')
      }
      return await response.json() as GenerateEditScriptStoryboardResponse
    },
    onSuccess: async (_result, variables) => {
      if (!projectId) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, variables.episodeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.pending(projectId, variables.episodeId) }),
      ])
    },
  })
}

export function useUpdateProjectEditScriptVideoBlockPrompt(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateEditScriptVideoBlockPromptInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        throw await readJsonError(response, 'Failed to update video arrangement prompt')
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

export function useMergeProjectEditScriptVideoBlocks(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: MergeEditScriptVideoBlocksInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'mergeVideoBlocks',
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

export function useArrangeProjectEditScriptVideoBlocks(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ArrangeEditScriptVideoBlocksInput) => {
      if (!projectId) throw new Error('Project ID is required')
      const response = await apiFetch(`/api/projects/${projectId}/edit-script`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'arrangeVideoBlocks',
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
