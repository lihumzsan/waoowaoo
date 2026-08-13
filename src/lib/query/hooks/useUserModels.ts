'use client'

import { useQuery } from '@tanstack/react-query'
import type { ModelCapabilities } from '@/lib/ai-registry/types'
import { queryKeys } from '../keys'
import { apiFetch } from '@/lib/api-fetch'

export interface UserModelOption {
    value: string
    label: string
    provider?: string
    providerName?: string
    capabilities?: ModelCapabilities
}

export interface UserModelsPayload {
    llm: UserModelOption[]
    image: UserModelOption[]
    video: UserModelOption[]
    music: UserModelOption[]
}

export function useUserModels() {
    return useQuery({
        queryKey: queryKeys.userModels.all(),
        queryFn: async () => {
            const response = await apiFetch('/api/user/models')
            if (!response.ok) {
                throw new Error('Failed to fetch user models')
            }
            const data = await response.json()
            return {
                llm: Array.isArray(data?.llm) ? data.llm : [],
                image: Array.isArray(data?.image) ? data.image : [],
                video: Array.isArray(data?.video) ? data.video : [],
                music: Array.isArray(data?.music) ? data.music : [],
            } as UserModelsPayload
        },
    })
}
