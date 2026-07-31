import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Project } from '@/types/project'
import { queryKeys } from '../keys'
import type { ProjectAssetsData } from '../hooks/useProjectAssets'
import {
    requestOperationMutationVoidWithError,
} from './mutation-shared'

interface DeleteProjectLocationContext {
    previousAssets: ProjectAssetsData | undefined
    previousProject: Project | undefined
}

function removeLocationFromAssets(
    previous: ProjectAssetsData | undefined,
    locationId: string,
): ProjectAssetsData | undefined {
    if (!previous) return previous
    return {
        ...previous,
        locations: (previous.locations || []).filter((location) => location.id !== locationId),
    }
}

function removeLocationFromProject(
    previous: Project | undefined,
    locationId: string,
): Project | undefined {
    if (!previous) return previous
    const currentLocations = previous.locations || []
    return {
        ...previous,
        locations: currentLocations.filter((location) => location.id !== locationId),
    }
}

export function useDeleteProjectLocation(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (locationId: string) => {
            await requestOperationMutationVoidWithError(
                `/api/projects/${projectId}/location?id=${encodeURIComponent(locationId)}`,
                { method: 'DELETE' },
                'Failed to delete location',
                queryClient,
            )
        },
        onMutate: async (locationId): Promise<DeleteProjectLocationContext> => {
            const assetsQueryKey = queryKeys.projectAssets.all(projectId)
            const projectQueryKey = queryKeys.projectData(projectId)

            await queryClient.cancelQueries({ queryKey: assetsQueryKey })
            await queryClient.cancelQueries({ queryKey: projectQueryKey })

            const previousAssets = queryClient.getQueryData<ProjectAssetsData>(assetsQueryKey)
            const previousProject = queryClient.getQueryData<Project>(projectQueryKey)

            queryClient.setQueryData<ProjectAssetsData | undefined>(assetsQueryKey, (previous) =>
                removeLocationFromAssets(previous, locationId),
            )
            queryClient.setQueryData<Project | undefined>(projectQueryKey, (previous) =>
                removeLocationFromProject(previous, locationId),
            )

            return {
                previousAssets,
                previousProject,
            }
        },
        onError: (_error, _locationId, context) => {
            if (!context) return
            queryClient.setQueryData(queryKeys.projectAssets.all(projectId), context.previousAssets)
            queryClient.setQueryData(queryKeys.projectData(projectId), context.previousProject)
        },
    })
}

/**
 * 更新项目场景名字
 */

export function useUpdateProjectLocationName(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ locationId, name }: { locationId: string; name: string }) => {
            await requestOperationMutationVoidWithError(`/api/assets/${locationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scope: 'project',
                    kind: 'location',
                    projectId,
                    name,
                })
            }, 'Failed to update location name', queryClient)
        },
    })
}

/**
 * 更新项目角色形象描述
 */

export function useUpdateProjectLocationDescription(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({
            locationId,
            description,
            imageIndex,
        }: {
            locationId: string
            description: string
            imageIndex?: number
        }) => {
            await requestOperationMutationVoidWithError(`/api/projects/${projectId}/location`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    locationId,
                    imageIndex: typeof imageIndex === 'number' ? imageIndex : 0,
                    description,
                }),
            }, 'Failed to update location description', queryClient)
        },
    })
}

/**
 * 创建项目场景
 */

export function useCreateProjectLocation(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (payload: {
            name: string
            description: string
        }) =>
            await requestOperationMutationVoidWithError(
                `/api/projects/${projectId}/location`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'Failed to create location',
                queryClient,
            ),
    })
}

export function useConfirmProjectLocationSelection(
    projectId: string,
    kind: 'location' | 'prop' = 'location',
) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ locationId }: { locationId: string }) =>
            await requestOperationMutationVoidWithError(
                `/api/assets/${locationId}/select-render`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        scope: 'project',
                        kind,
                        projectId,
                        confirm: true,
                    }),
                },
                '确认选择失败',
                queryClient,
            ),
    })
}
