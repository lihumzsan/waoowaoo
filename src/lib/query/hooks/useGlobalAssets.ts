'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import type { MediaRef } from '@/types/project'
import { apiFetch } from '@/lib/api-fetch'
import { useAssets } from './useAssets'
import { groupAssetsByKind } from '@/lib/assets/grouping'
import {
    requestOperationMutationVoidWithError,
} from '@/lib/query/mutations/mutation-shared'

// ============ 类型定义 ============
export interface GlobalCharacterAppearance {
    id: string
    appearanceIndex: number
    changeReason: string
    description: string | null
    descriptionSource: string | null
    imageUrl: string | null
    media?: MediaRef | null
    imageUrls: string[]
    imageMedias?: MediaRef[]
    selectedIndex: number | null
    previousImageUrl: string | null
    previousMedia?: MediaRef | null
    previousImageUrls: string[]
    previousImageMedias?: MediaRef[]
    imageTaskRunning: boolean
    lastError?: { code: string; message: string } | null
}

export interface GlobalCharacter {
    id: string
    name: string
    folderId: string | null
    appearances: GlobalCharacterAppearance[]
}

export interface GlobalLocationImage {
    id: string
    imageIndex: number
    description: string | null
    imageUrl: string | null
    media?: MediaRef | null
    previousImageUrl: string | null
    previousMedia?: MediaRef | null
    isSelected: boolean
    imageTaskRunning: boolean
    lastError?: { code: string; message: string } | null
}

export interface GlobalLocation {
    id: string
    name: string
    summary: string | null
    folderId: string | null
    images: GlobalLocationImage[]
}

export interface GlobalProp {
    id: string
    name: string
    summary: string | null
    folderId: string | null
    images: GlobalLocationImage[]
}

export interface GlobalFolder {
    id: string
    name: string
}

// ============ 查询 Hooks ============

/**
 * 获取中心资产库角色列表
 */
export function useGlobalCharacters(folderId?: string | null) {
    const assetsQuery = useAssets({
        scope: 'global',
        folderId,
        kind: 'character',
    })
    return {
        ...assetsQuery,
        data: groupAssetsByKind(assetsQuery.data ?? []).character.map((asset) => ({
            id: asset.id,
            name: asset.name,
            folderId: asset.folderId,
            appearances: asset.variants.map((variant) => ({
                id: variant.id,
                appearanceIndex: variant.index,
                changeReason: variant.label,
                description: variant.description,
                descriptionSource: null,
                imageUrl: variant.renders.find((render) => render.isSelected)?.imageUrl
                    ?? variant.renders[0]?.imageUrl
                    ?? null,
                media: variant.renders.find((render) => render.isSelected)?.media
                    ?? variant.renders[0]?.media
                    ?? null,
                imageUrls: variant.renders.map((render) => render.imageUrl).filter((imageUrl): imageUrl is string => !!imageUrl),
                imageMedias: variant.renders.map((render) => render.media).filter((media): media is MediaRef => !!media),
                selectedIndex: variant.selectionState.selectedRenderIndex,
                previousImageUrl: variant.renders[0]?.previousImageUrl ?? null,
                previousMedia: variant.renders[0]?.previousMedia ?? null,
                previousImageUrls: variant.renders.map((render) => render.previousImageUrl).filter((imageUrl): imageUrl is string => !!imageUrl),
                previousImageMedias: variant.renders.map((render) => render.previousMedia).filter((media): media is MediaRef => !!media),
                imageTaskRunning: asset.taskState.isRunning || variant.taskState.isRunning || variant.renders.some((render) => render.taskState.isRunning),
                lastError: variant.renders.find((render) => render.taskState.lastError)?.taskState.lastError
                    ?? variant.taskState.lastError
                    ?? asset.taskState.lastError,
            })),
        })) as GlobalCharacter[],
    }
}

/**
 * 获取中心资产库场景列表
 */
export function useGlobalLocations(folderId?: string | null) {
    const assetsQuery = useAssets({
        scope: 'global',
        folderId,
        kind: 'location',
    })
    return {
        ...assetsQuery,
        data: groupAssetsByKind(assetsQuery.data ?? []).location.map((asset) => ({
            id: asset.id,
            name: asset.name,
            summary: asset.summary,
            folderId: asset.folderId,
            images: asset.variants.map((variant) => {
                const render = variant.renders[0] ?? null
                return {
                    id: variant.id,
                    imageIndex: variant.index,
                    description: variant.description,
                    imageUrl: render?.imageUrl ?? null,
                    media: render?.media ?? null,
                    previousImageUrl: render?.previousImageUrl ?? null,
                    previousMedia: render?.previousMedia ?? null,
                    isSelected: render?.isSelected ?? false,
                    imageTaskRunning: asset.taskState.isRunning || variant.taskState.isRunning || render?.taskState.isRunning === true,
                    lastError: render?.taskState.lastError ?? variant.taskState.lastError ?? asset.taskState.lastError,
                }
            }),
        })) as GlobalLocation[],
    }
}

export function useGlobalProps(folderId?: string | null) {
    const assetsQuery = useAssets({
        scope: 'global',
        folderId,
        kind: 'prop',
    })
    return {
        ...assetsQuery,
        data: groupAssetsByKind(assetsQuery.data ?? []).prop.map((asset) => ({
            id: asset.id,
            name: asset.name,
            summary: asset.summary,
            folderId: asset.folderId,
            images: asset.variants.map((variant) => {
                const render = variant.renders[0] ?? null
                return {
                    id: variant.id,
                    imageIndex: variant.index,
                    description: variant.description,
                    imageUrl: render?.imageUrl ?? null,
                    media: render?.media ?? null,
                    previousImageUrl: render?.previousImageUrl ?? null,
                    previousMedia: render?.previousMedia ?? null,
                    isSelected: render?.isSelected ?? false,
                    imageTaskRunning: asset.taskState.isRunning || variant.taskState.isRunning || render?.taskState.isRunning === true,
                    lastError: render?.taskState.lastError ?? variant.taskState.lastError ?? asset.taskState.lastError,
                }
            }),
        })) as GlobalProp[],
    }
}

/**
 * 获取中心资产库文件夹列表
 */
export function useGlobalFolders() {
    return useQuery({
        queryKey: queryKeys.globalAssets.folders(),
        queryFn: async () => {
            const res = await apiFetch('/api/asset-hub/folders')
            if (!res.ok) throw new Error('Failed to fetch folders')
            const data = await res.json()
            return data.folders as GlobalFolder[]
        },
    })
}

// ============ 文件夹 Mutation Hooks ============

/**
 * 创建文件夹
 */
export function useCreateFolder() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ name }: { name: string }) =>
            await requestOperationMutationVoidWithError('/api/asset-hub/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            }, queryClient),
    })
}

/**
 * 更新文件夹
 */
export function useUpdateFolder() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ folderId, name }: { folderId: string; name: string }) =>
            await requestOperationMutationVoidWithError(`/api/asset-hub/folders/${folderId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            }, queryClient),
    })
}

/**
 * 删除文件夹
 */
export function useDeleteFolder() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ folderId }: { folderId: string }) =>
            await requestOperationMutationVoidWithError(`/api/asset-hub/folders/${folderId}`, {
                method: 'DELETE',
            }, queryClient),
    })
}

/**
 * 刷新所有中心资产库数据
 */
export function useRefreshGlobalAssets() {
    const queryClient = useQueryClient()

    return () => {
        queryClient.invalidateQueries({
            queryKey: queryKeys.assets.all(),
        })
        queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.all() })
    }
}
