import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { apiFetch } from '@/lib/api-fetch'
import {
    clearTaskTargetOverlay,
    upsertTaskTargetOverlay,
} from '../task-target-overlay'
import {
    invalidateQueryTemplates,
    requestJsonWithError,
} from './mutation-shared'
import { useAssetOperationBillingPlan } from '../use-asset-operation-billing-plan'

export function useRegenerateCharacterGroup(projectId: string) {
    const queryClient = useQueryClient()
    const assetOperationBillingPlan = useAssetOperationBillingPlan()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async ({
            characterId,
            appearanceId,
            count,
        }: {
            characterId: string
            appearanceId: string
            count?: number
        }) => {
            const requestBody = {
                scope: 'project',
                kind: 'character',
                projectId,
                appearanceId,
                count,
            }
            const confirmedMaxCost = await assetOperationBillingPlan(characterId, 'generate', requestBody)
            return await requestJsonWithError(`/api/assets/${characterId}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...requestBody,
                    ...(typeof confirmedMaxCost === 'number' ? { confirmedMaxCost } : {}),
                })
            }, 'Failed to regenerate group')
        },
        onMutate: ({ appearanceId }) => {
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
                intent: 'regenerate',
            })
        },
        onError: (_error, { appearanceId }) => {
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
            })
        },
        onSettled: invalidateProjectAssets,
    })
}

/**
 * 重新生成单张角色图片
 */

export function useRegenerateSingleCharacterImage(projectId: string) {
    const queryClient = useQueryClient()
    const assetOperationBillingPlan = useAssetOperationBillingPlan()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async ({
            characterId,
            appearanceId,
            imageIndex,
        }: {
            characterId: string
            appearanceId: string
            imageIndex: number
        }) => {
            const requestBody = {
                scope: 'project',
                kind: 'character',
                projectId,
                appearanceId,
                imageIndex,
            }
            const confirmedMaxCost = await assetOperationBillingPlan(characterId, 'generate', requestBody)
            return await requestJsonWithError(`/api/assets/${characterId}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...requestBody,
                    ...(typeof confirmedMaxCost === 'number' ? { confirmedMaxCost } : {}),
                })
            }, 'Failed to regenerate image')
        },
        onMutate: ({ appearanceId }) => {
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
                intent: 'regenerate',
            })
        },
        onError: (_error, { appearanceId }) => {
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
            })
        },
        onSettled: invalidateProjectAssets,
    })
}

/**
 * 重新生成场景组图片
 */

export function useUpdateProjectAppearanceDescription(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async ({
            characterId,
            appearanceId,
            description,
            descriptionIndex,
        }: {
            characterId: string
            appearanceId: string
            description: string
            descriptionIndex?: number
        }) => {
            return await requestJsonWithError(`/api/assets/${characterId}/variants/${appearanceId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scope: 'project',
                    kind: 'character',
                    projectId,
                    description,
                    descriptionIndex: typeof descriptionIndex === 'number' ? descriptionIndex : 0,
                }),
            }, 'Failed to update appearance description')
        },
        onSuccess: invalidateProjectAssets,
    })
}

export function useBatchGenerateCharacterImages(projectId: string) {
    const queryClient = useQueryClient()
    const assetOperationBillingPlan = useAssetOperationBillingPlan()

    return useMutation({
        mutationFn: async (items: Array<{ characterId: string; appearanceId: string }>) => {
            const results = await Promise.allSettled(
                items.map(async (item) => {
                    const requestBody = {
                        scope: 'project',
                        kind: 'character',
                        projectId,
                        appearanceId: item.appearanceId,
                    }
                    const confirmedMaxCost = await assetOperationBillingPlan(item.characterId, 'generate', requestBody)
                    return await apiFetch(`/api/assets/${item.characterId}/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ...requestBody,
                            ...(typeof confirmedMaxCost === 'number' ? { confirmedMaxCost } : {}),
                        })
                    })
                })
            )
            return results
        },
        onMutate: (items) => {
            for (const item of items) {
                upsertTaskTargetOverlay(queryClient, {
                    projectId,
                    targetType: 'CharacterAppearance',
                    targetId: item.appearanceId,
                    intent: 'generate',
                })
            }
        },
        onError: (_error, items) => {
            for (const item of items) {
                clearTaskTargetOverlay(queryClient, {
                    projectId,
                    targetType: 'CharacterAppearance',
                    targetId: item.appearanceId,
                })
            }
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        }
    })
}
