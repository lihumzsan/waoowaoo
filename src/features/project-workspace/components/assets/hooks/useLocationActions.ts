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
import { useToast } from '@/contexts/ToastContext'

interface UseLocationActionsProps {
    projectId: string
    assetType?: 'location' | 'prop'
}

export function useLocationActions({
    projectId,
    assetType = 'location',
}: UseLocationActionsProps) {
    const t = useTranslations('assets')
    const { showError, showToast } = useToast()
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
                showError(error, t(`${assetKey}.deleteFailed`, { error: t('common.unknownError') }))
            }
        }
    }, [assetKey, assetType, deleteLocationMutation, propActions, showError, t])

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
            showError(error, t('image.selectFailed', { error: t('common.unknownError') }))
        }
    }, [assetType, propActions, selectLocationImageMutation, showError, t])

    // 确认选择并删除其他候选图片
    const handleConfirmLocationSelection = useCallback(async (locationId: string) => {
        try {
            await confirmLocationSelectionMutation.mutateAsync({ locationId })
            showToast(t('image.confirmSuccess'), 'success')
        } catch (error: unknown) {
            if (isAbortError(error)) {
                _ulogInfo('请求被中断（可能是页面刷新），后端仍在执行')
                return
            }
            showError(error, t('image.confirmFailed', { error: t('common.unknownError') }))
        }
    }, [confirmLocationSelectionMutation, showError, showToast, t])

    return {
        // 🔥 暴露 locations 供组件使用
        locations,
        handleDeleteLocation,
        handleSelectLocationImage,
        handleConfirmLocationSelection,
    }
}
