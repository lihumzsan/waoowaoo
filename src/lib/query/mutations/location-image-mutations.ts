import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import type { Location, Project } from '@/types/project'
import { queryKeys } from '../keys'
import type { ProjectAssetsData } from '../hooks/useProjectAssets'
import {
    requestOperationMutationVoidWithError,
} from './mutation-shared'

interface SelectProjectLocationImageContext {
    previousAssets: ProjectAssetsData | undefined
    previousProject: Project | undefined
    targetKey: string
    requestId: number
}

function applyLocationSelectionToLocations(
    locations: Location[],
    locationId: string,
    selectedIndex: number | null,
): Location[] {
    return locations.map((location) => {
        if (location.id !== locationId) return location
        const selectedImageId =
            selectedIndex === null
                ? null
                : (location.images || []).find((image) => image.imageIndex === selectedIndex)?.id ?? null
        return {
            ...location,
            selectedImageId,
            images: (location.images || []).map((image) => ({
                ...image,
                isSelected: selectedIndex !== null && image.imageIndex === selectedIndex,
            })),
        }
    })
}

function applyLocationSelectionToAssets(
    previous: ProjectAssetsData | undefined,
    locationId: string,
    selectedIndex: number | null,
): ProjectAssetsData | undefined {
    if (!previous) return previous
    return {
        ...previous,
        locations: applyLocationSelectionToLocations(previous.locations || [], locationId, selectedIndex),
    }
}

function applyLocationSelectionToProject(
    previous: Project | undefined,
    locationId: string,
    selectedIndex: number | null,
): Project | undefined {
    if (!previous) return previous
    const currentLocations = previous.locations || []
    return {
        ...previous,
        locations: applyLocationSelectionToLocations(currentLocations, locationId, selectedIndex),
    }
}

/**
 * 上传项目场景图片
 */

export function useUploadProjectLocationImage(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({
            file, locationId, imageIndex
        }: {
            file: File
            locationId: string
            imageIndex?: number
        }) => {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('scope', 'project')
            formData.append('kind', 'location')
            formData.append('projectId', projectId)
            if (imageIndex !== undefined) formData.append('imageIndex', imageIndex.toString())

            await requestOperationMutationVoidWithError(`/api/assets/${locationId}/upload-render`, {
                method: 'POST',
                body: formData
            }, queryClient)
        },
    })
}

/**
 * 选择项目场景图片
 */

export function useSelectProjectLocationImage(projectId: string) {
    const queryClient = useQueryClient()
    const latestRequestIdByTargetRef = useRef<Record<string, number>>({})

    return useMutation({
        mutationFn: async ({
            locationId, imageIndex
        }: {
            locationId: string
            imageIndex: number | null
            confirm?: boolean
        }) => {
            await requestOperationMutationVoidWithError(`/api/assets/${locationId}/select-render`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scope: 'project',
                    kind: 'location',
                    projectId,
                    imageIndex,
                })
            }, queryClient)
        },
        onMutate: async (variables): Promise<SelectProjectLocationImageContext> => {
            const targetKey = variables.locationId
            const requestId = (latestRequestIdByTargetRef.current[targetKey] ?? 0) + 1
            latestRequestIdByTargetRef.current[targetKey] = requestId

            const assetsQueryKey = queryKeys.projectAssets.all(projectId)
            const projectQueryKey = queryKeys.projectData(projectId)

            await queryClient.cancelQueries({ queryKey: assetsQueryKey })
            await queryClient.cancelQueries({ queryKey: projectQueryKey })

            const previousAssets = queryClient.getQueryData<ProjectAssetsData>(assetsQueryKey)
            const previousProject = queryClient.getQueryData<Project>(projectQueryKey)

            queryClient.setQueryData<ProjectAssetsData | undefined>(assetsQueryKey, (previous) =>
                applyLocationSelectionToAssets(previous, variables.locationId, variables.imageIndex),
            )
            queryClient.setQueryData<Project | undefined>(projectQueryKey, (previous) =>
                applyLocationSelectionToProject(previous, variables.locationId, variables.imageIndex),
            )

            return {
                previousAssets,
                previousProject,
                targetKey,
                requestId,
            }
        },
        onError: (_error, _variables, context) => {
            if (!context) return
            const latestRequestId = latestRequestIdByTargetRef.current[context.targetKey]
            if (latestRequestId !== context.requestId) return
            queryClient.setQueryData(queryKeys.projectAssets.all(projectId), context.previousAssets)
            queryClient.setQueryData(queryKeys.projectData(projectId), context.previousProject)
        },
    })
}

/**
 * 撤回项目场景图片
 */

export function useUndoProjectLocationImage(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (locationId: string) => {
            await requestOperationMutationVoidWithError(`/api/assets/${locationId}/revert-render`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scope: 'project',
                    kind: 'location',
                    projectId,
                })
            }, queryClient)
        },
    })
}
