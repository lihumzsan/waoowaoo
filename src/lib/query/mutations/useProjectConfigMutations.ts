import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Project } from '@/types/project'
import { queryKeys } from '../keys'
import {
  invalidateQueryTemplates,
  requestJsonWithError,
} from './mutation-shared'
import { capabilitySelectionsToCommand } from '@/lib/ai-registry/capability-selection-command'
import type { CapabilitySelections } from '@/lib/ai-registry/types'

/**
 * 从资产中心复制到项目资产
 */

export function useCopyProjectAssetFromGlobal(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async ({
            type,
            targetId,
            globalAssetId,
        }: {
            type: 'character' | 'location' | 'prop'
            targetId: string
            globalAssetId: string
        }) => {
            return await requestJsonWithError(`/api/assets/${targetId}/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind: type,
                    projectId,
                    globalAssetId,
                }),
            }, 'Failed to copy from global')
        },
        onSuccess: invalidateProjectAssets,
    })
}

/**
 * AI 修改镜头提示词（项目）
 */

type ProjectConfigMutationInput =
    | { key: string; value: unknown }
    | { patch: Record<string, unknown> }

function resolveProjectConfigPatch(input: ProjectConfigMutationInput): Record<string, unknown> {
    if ('patch' in input) return input.patch
    return { [input.key]: input.value }
}

function serializeProjectConfigPatch(patch: Record<string, unknown>): Record<string, unknown> {
    if (!Object.prototype.hasOwnProperty.call(patch, 'capabilityOverrides')) return patch
    return {
        ...patch,
        capabilityOverrides: capabilitySelectionsToCommand(
            patch.capabilityOverrides as CapabilitySelections | null | undefined,
        ),
    }
}

export function useUpdateProjectConfig(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (input: ProjectConfigMutationInput) =>
            await requestJsonWithError(
                `/api/projects/${projectId}/config`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(serializeProjectConfigPatch(resolveProjectConfigPatch(input))),
                },
                'Failed to update config',
            ),
        onMutate: async (input) => {
            const projectQueryKey = queryKeys.projectData(projectId)
            await queryClient.cancelQueries({ queryKey: projectQueryKey })
            const previousProject = queryClient.getQueryData<Project>(projectQueryKey)
            const patch = resolveProjectConfigPatch(input)

            queryClient.setQueryData<Project | undefined>(projectQueryKey, (prev) => {
                if (!prev) return prev
                return {
                    ...prev,
                    ...patch,
                }
            })

            return { previousProject }
        },
        onError: (_error, _variables, context) => {
            if (context?.previousProject) {
                queryClient.setQueryData(queryKeys.projectData(projectId), context.previousProject)
            }
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectData(projectId)])
        },
    })
}
