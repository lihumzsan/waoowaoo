'use client'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'

/**
 * useLocationActions - 场景资产操作 Hook
 * 从项目资产库模块提取，负责场景的 CRUD 和图片选择操作
 * 
 * 🔥 V6.5 重构：直接订阅 useProjectAssets，消除 props drilling
 */

import { useCallback, useMemo } from 'react'
import { isAbortError } from '@/lib/error-utils'
import {
    useAssetActions,
    useProjectAssets,
    useDeleteProjectLocation,
    useSelectProjectLocationImage,
    useConfirmProjectLocationSelection,
} from '@/lib/query/hooks'

interface UseLocationActionsProps {
    projectId: string
    assetType?: 'location' | 'prop'
    showToast?: (message: string, type: 'success' | 'warning' | 'error') => void
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string') return message
    }
    return fallback
}

export function useLocationActions({
    projectId,
    assetType = 'location',
    showToast
}: UseLocationActionsProps) {
    const t = useTranslations('assets')
    // 🔥 直接订阅缓存 - 消除 props drilling
    const { data: assets } = useProjectAssets(projectId)
    const locations = useMemo(
        () => assetType === 'prop' ? assets?.props ?? [] : assets?.locations ?? [],
        [assetType, assets?.locations, assets?.props],
    )
    const propActions = useAssetActions({ scope: 'project', projectId, kind: 'prop' })
    const assetKey = assetType === 'prop' ? 'prop' : 'location'

    const deleteLocationMutation = useDeleteProjectLocation(projectId)
    const selectLocationImageMutation = useSelectProjectLocationImage(projectId)
    const confirmLocationSelectionMutation = useConfirmProjectLocationSelection(projectId, assetType)

    // 删除场景
    const handleDeleteLocation = useCallback(async (locationId: string) => {
        if (!confirm(t(`${assetKey}.deleteConfirm`))) return
        try {
            if (assetType === 'prop') {
                await propActions.remove(locationId)
            } else {
                await deleteLocationMutation.mutateAsync(locationId)
            }
        } catch (error: unknown) {
            if (!isAbortError(error)) {
                alert(t(`${assetKey}.deleteFailed`, { error: getErrorMessage(error, t('common.unknownError')) }))
            }
        }
    }, [assetKey, assetType, deleteLocationMutation, propActions, t])

    // 处理场景图片选择
    const handleSelectLocationImage = useCallback(async (locationId: string, imageIndex: number | null) => {
        try {
            if (assetType === 'prop') {
                await propActions.selectRender({ id: locationId, imageIndex })
            } else {
                await selectLocationImageMutation.mutateAsync({ locationId, imageIndex })
            }
        } catch (error: unknown) {
            if (isAbortError(error)) {
                _ulogInfo('请求被中断（可能是页面刷新），后端仍在执行')
                return
            }
            alert(t('image.selectFailed', { error: getErrorMessage(error, t('common.unknownError')) }))
        }
    }, [assetType, propActions, selectLocationImageMutation, t])

    // 确认选择并删除其他候选图片
    const handleConfirmLocationSelection = useCallback(async (locationId: string) => {
        try {
            await confirmLocationSelectionMutation.mutateAsync({ locationId })
            showToast?.(`✓ ${t('image.confirmSuccess')}`, 'success')
        } catch (error: unknown) {
            if (isAbortError(error)) {
                _ulogInfo('请求被中断（可能是页面刷新），后端仍在执行')
                return
            }
            showToast?.(t('image.confirmFailed', { error: getErrorMessage(error, t('common.unknownError')) }), 'error')
        }
    }, [confirmLocationSelectionMutation, showToast, t])

    return {
        // 🔥 暴露 locations 供组件使用
        locations,
        handleDeleteLocation,
        handleSelectLocationImage,
        handleConfirmLocationSelection,
    }
}
