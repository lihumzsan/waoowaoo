import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
    requestOperationMutationVoidWithError,
} from './mutation-shared'

export function useUpdateProjectAppearanceDescription(projectId: string) {
    const queryClient = useQueryClient()

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
            await requestOperationMutationVoidWithError(`/api/assets/${characterId}/variants/${appearanceId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scope: 'project',
                    kind: 'character',
                    projectId,
                    description,
                    descriptionIndex: typeof descriptionIndex === 'number' ? descriptionIndex : 0,
                }),
            }, queryClient)
        },
    })
}
