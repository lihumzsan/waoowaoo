'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import type { Project } from '@/types/project'
import { apiFetch } from '@/lib/api-fetch'
import { readClientApiError } from '@/lib/errors/client'

// ============ 项目数据 Hook ============

interface ProjectDataResponse {
    project: Project
}

/**
 * 获取项目基础数据
 * 替代原有的 useProject hook
 */
export function useProjectData(projectId: string | null) {
    return useQuery({
        queryKey: queryKeys.projectData(projectId || ''),
        queryFn: async () => {
            if (!projectId) throw new Error('Project ID is required')
            const res = await apiFetch(`/api/projects/${projectId}`)
            if (!res.ok) {
                throw await readClientApiError(res)
            }
            const data: ProjectDataResponse = await res.json()
            return data.project
        },
        enabled: !!projectId,
        staleTime: 5000,
    })
}

/**
 * 刷新项目数据
 */
export function useRefreshProjectData(projectId: string | null) {
    const queryClient = useQueryClient()

    return () => {
        if (projectId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
        }
    }
}
