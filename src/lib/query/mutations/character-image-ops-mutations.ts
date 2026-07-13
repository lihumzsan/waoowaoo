import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { upsertTaskTargetOverlay } from '../task-target-overlay'
import {
    invalidateQueryTemplates,
    requireTaskSubmissionReceipt,
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
            const confirmation = await assetOperationBillingPlan(characterId, 'generate', requestBody)
            const result = await requestJsonWithError<unknown>(`/api/assets/${characterId}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...requestBody,
                    ...confirmation,
                })
            }, 'Failed to regenerate group')
            return requireTaskSubmissionReceipt(result)
        },
        onSuccess: (receipt, { appearanceId }) => {
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
                runningTaskId: receipt.taskId,
                runningTaskType: receipt.taskType,
                intent: 'regenerate',
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
            const confirmation = await assetOperationBillingPlan(characterId, 'generate', requestBody)
            const result = await requestJsonWithError<unknown>(`/api/assets/${characterId}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...requestBody,
                    ...confirmation,
                })
            }, 'Failed to regenerate image')
            return requireTaskSubmissionReceipt(result)
        },
        onSuccess: (receipt, { appearanceId }) => {
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
                runningTaskId: receipt.taskId,
                runningTaskType: receipt.taskType,
                intent: 'regenerate',
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
