import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import {
    invalidateQueryTemplates,
    requestJsonWithError,
} from './mutation-shared'

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
