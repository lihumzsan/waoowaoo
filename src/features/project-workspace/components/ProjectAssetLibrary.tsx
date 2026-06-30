'use client'

import { useTranslations } from 'next-intl'
/**
 * 项目资产库 - 小说推文模式专用
 * 包含资产展示、复制、生成和编辑
 * 
 * 重构说明 v2:
 * - 角色和场景操作函数已提取到 hooks/useCharacterActions 和 hooks/useLocationActions
 * - 批量生成逻辑已提取到 hooks/useBatchGeneration
 * - 弹窗状态已提取到 hooks/useAssetModals
 * - UI已拆分为 CharacterSection, LocationSection, AssetToolbar, AssetModals 组件
 */

import { useState, useCallback, useMemo } from 'react'
import { Character, CharacterAppearance } from '@/types/project'
import {
  useAssetActions,
  useGenerateProjectCharacterImage,
  useGenerateProjectLocationImage,
  useAssets,
  useRefreshProjectAssets,
} from '@/lib/query/hooks'

// Hooks
import { useCharacterActions } from './assets/hooks/useCharacterActions'
import { useLocationActions } from './assets/hooks/useLocationActions'
import { useBatchGeneration } from './assets/hooks/useBatchGeneration'
import { useAssetModals } from './assets/hooks/useAssetModals'
import { useAssetsCopyFromHub } from './assets/hooks/useAssetsCopyFromHub'
import { useAssetImageMaintenance } from './assets/hooks/useAssetImageMaintenance'

// Components
import CharacterSection from './assets/CharacterSection'
import LocationSection from './assets/LocationSection'
import AssetToolbar from './assets/AssetToolbar'
import AssetFilterBar, { type AssetKindFilter } from './assets/AssetFilterBar'
import ProjectAssetLibraryStatusOverlays from './assets/ProjectAssetLibraryStatusOverlays'
import ProjectAssetLibraryModals from './assets/ProjectAssetLibraryModals'

interface ProjectAssetLibraryProps {
  projectId: string
  focusCharacterId?: string | null
  focusCharacterRequestId?: number
}

export default function ProjectAssetLibrary({
  projectId,
  focusCharacterId = null,
  focusCharacterRequestId = 0,
}: ProjectAssetLibraryProps) {
  const { data: assets = [] } = useAssets({
    scope: 'project',
    projectId,
  })
  const characters = useMemo(
    () => assets.filter((asset) => asset.kind === 'character'),
    [assets],
  )
  const locations = useMemo(
    () => assets.filter((asset) => asset.kind === 'location'),
    [assets],
  )
  const props = useMemo(
    () => assets.filter((asset) => asset.kind === 'prop'),
    [assets],
  )
  const propAssetActions = useAssetActions({
    scope: 'project',
    projectId,
    kind: 'prop',
  })
  // 🔥 使用 React Query 刷新，替代 onRefresh prop
  const refreshAssets = useRefreshProjectAssets(projectId)
  const onRefresh = useCallback(() => { refreshAssets() }, [refreshAssets])

  // 🔥 V6.6 重构：使用 mutation hooks 替代 onGenerateImage prop
  const generateCharacterImage = useGenerateProjectCharacterImage(projectId)
  const generateLocationImage = useGenerateProjectLocationImage(projectId)

  // 🔥 内部图片生成函数 - 使用 mutation hooks 实现乐观更新
  const handleGenerateImage = useCallback(async (
    type: 'character' | 'location' | 'prop',
    id: string,
    appearanceId?: string,
    count?: number,
  ) => {
    if (type === 'character' && appearanceId) {
      await generateCharacterImage.mutateAsync({ characterId: id, appearanceId, count })
    } else if (type === 'location') {
      await generateLocationImage.mutateAsync({ locationId: id, count })
    } else if (type === 'prop') {
      await propAssetActions.generate({ id, count })
    }
  }, [generateCharacterImage, generateLocationImage, propAssetActions])

  const t = useTranslations('assets')
  // 计算资产总数
  const totalAppearances = characters.reduce((sum, character) => sum + character.variants.length, 0)
  const totalLocations = locations.length
  const totalProps = props.length
  const totalAssets = totalAppearances + totalLocations + totalProps

  // 本地 UI 状态
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null)
  const [kindFilter, setKindFilter] = useState<AssetKindFilter>('all')
  // 最终展示的资产列表（按类型筛选）
  const filteredCharacters = useMemo(
    () => characters,
    [characters],
  )
  const filteredLocations = useMemo(
    () => locations,
    [locations],
  )
  const filteredProps = useMemo(
    () => props,
    [props],
  )

  // 筛选后的计数
  const filteredAppearances = filteredCharacters.reduce((sum, character) => sum + character.variants.length, 0)
  const filteredLocCount = filteredLocations.length
  const filteredPropCount = filteredProps.length
  const filteredTotal = filteredAppearances + filteredLocCount + filteredPropCount

  // 辅助：获取角色形象
  const getAppearances = (character: Character): CharacterAppearance[] => {
    return character.appearances || []
  }

  // 显示提示
  const showToast = useCallback((message: string, type: 'success' | 'warning' | 'error' = 'success', duration = 3000) => {
    setToast({ message, type })
    setTimeout(() => setToast(null), duration)
  }, [])

  // === 使用提取的 Hooks ===

  // 🔥 V6.5 重构：hooks 现在内部订阅 useProjectAssets，不再需要传 characters/locations

  // 批量生成
  const {
    activeTaskKeys,
    registerTransientTaskKey,
    clearTransientTaskKey,
  } = useBatchGeneration({
    projectId,
    handleGenerateImage
  })

  const {
    copyFromGlobalTarget,
    isGlobalCopyInFlight,
    handleCopyFromGlobal,
    handleCopyLocationFromGlobal,
    handleCopyPropFromGlobal,
    handleConfirmCopyFromGlobal,
    handleCloseCopyPicker,
  } = useAssetsCopyFromHub({
    projectId,
    onRefresh,
    showToast,
  })

  // 角色操作
  const {
    handleDeleteCharacter,
    handleDeleteAppearance,
    handleSelectCharacterImage,
    handleConfirmSelection,
    handleRegenerateSingleCharacter,
    handleRegenerateCharacterGroup
  } = useCharacterActions({
    projectId,
    showToast
  })

  // 场景操作
  const {
    handleDeleteLocation,
    handleSelectLocationImage,
    handleConfirmLocationSelection,
    handleRegenerateSingleLocation,
    handleRegenerateLocationGroup
  } = useLocationActions({
    projectId,
    showToast
  })
  const {
    handleDeleteLocation: handleDeleteProp,
    handleSelectLocationImage: handleSelectPropImage,
    handleConfirmLocationSelection: handleConfirmPropSelection,
    handleRegenerateSingleLocation: handleRegenerateSingleProp,
    handleRegenerateLocationGroup: handleRegeneratePropGroup,
  } = useLocationActions({
    projectId,
    assetType: 'prop',
    showToast,
  })

  // 弹窗状态
  const {
    editingAppearance,
    editingLocation,
    editingProp,
    showAddCharacter,
    showAddLocation,
    showAddProp,
    setShowAddCharacter,
    setShowAddLocation,
    setShowAddProp,
    handleEditAppearance,
    handleEditLocation,
    handleEditProp,
    closeEditingAppearance,
    closeEditingLocation,
    closeEditingProp,
    closeAddCharacter,
    closeAddLocation,
    closeAddProp
  } = useAssetModals({
    projectId
  })
  const {
    handleUndoCharacter,
    handleUndoLocation,
    handleUpdateAppearanceDescription,
    handleUpdateLocationDescription,
  } = useAssetImageMaintenance({
    projectId,
    t,
    showToast,
    onRefresh,
    editingAppearance,
    editingLocation,
    closeEditingAppearance,
    closeEditingLocation,
  })

  return (
    <div className="space-y-4">
      <ProjectAssetLibraryStatusOverlays
        toast={toast}
        onCloseToast={() => setToast(null)}
      />

      {/* 资产工具栏 */}
      <AssetToolbar
        projectId={projectId}
        totalAssets={totalAssets}
        totalAppearances={totalAppearances}
        totalLocations={totalLocations}
        totalProps={totalProps}
      />

      {/* 资产筛选栏 */}
      <AssetFilterBar
        kindFilter={kindFilter}
        onKindFilterChange={setKindFilter}
        counts={{
          all: filteredTotal,
          character: filteredAppearances,
          location: filteredLocCount,
          prop: filteredPropCount,
        }}
      />

      {(kindFilter === 'all' || kindFilter === 'character') && (
          <CharacterSection
            key="character"
            projectId={projectId}
            focusCharacterId={focusCharacterId}
            focusCharacterRequestId={focusCharacterRequestId}
            activeTaskKeys={activeTaskKeys}
            onClearTaskKey={clearTransientTaskKey}
            onRegisterTransientTaskKey={registerTransientTaskKey}
            onAddCharacter={() => setShowAddCharacter(true)}
            onDeleteCharacter={handleDeleteCharacter}
            onDeleteAppearance={handleDeleteAppearance}
            onEditAppearance={handleEditAppearance}
            handleGenerateImage={handleGenerateImage}
            onSelectImage={handleSelectCharacterImage}
            onConfirmSelection={handleConfirmSelection}
            onRegenerateSingle={handleRegenerateSingleCharacter}
            onRegenerateGroup={handleRegenerateCharacterGroup}
            onUndo={handleUndoCharacter}
            onImageClick={setPreviewImage}
            onCopyFromGlobal={handleCopyFromGlobal}
            getAppearances={getAppearances}
            filterIds={null}
          />
      )}
      {(kindFilter === 'all' || kindFilter === 'location') && (
          <LocationSection
            key="location"
            projectId={projectId}
            activeTaskKeys={activeTaskKeys}
            onClearTaskKey={clearTransientTaskKey}
            onRegisterTransientTaskKey={registerTransientTaskKey}
            onAddLocation={() => setShowAddLocation(true)}
            onDeleteLocation={handleDeleteLocation}
            onEditLocation={handleEditLocation}
            handleGenerateImage={handleGenerateImage}
            onSelectImage={handleSelectLocationImage}
            onConfirmSelection={handleConfirmLocationSelection}
            onRegenerateSingle={handleRegenerateSingleLocation}
            onRegenerateGroup={handleRegenerateLocationGroup}
            onUndo={handleUndoLocation}
            onImageClick={setPreviewImage}
            onCopyFromGlobal={handleCopyLocationFromGlobal}
            filterIds={null}
          />
      )}
      {(kindFilter === 'all' || kindFilter === 'prop') && (
          <LocationSection
            key="prop"
            projectId={projectId}
            assetType="prop"
            activeTaskKeys={activeTaskKeys}
            onClearTaskKey={clearTransientTaskKey}
            onRegisterTransientTaskKey={registerTransientTaskKey}
            onAddLocation={() => setShowAddProp(true)}
            onDeleteLocation={handleDeleteProp}
            onEditLocation={handleEditProp}
            handleGenerateImage={handleGenerateImage}
            onSelectImage={handleSelectPropImage}
            onConfirmSelection={handleConfirmPropSelection}
            onRegenerateSingle={handleRegenerateSingleProp}
            onRegenerateGroup={handleRegeneratePropGroup}
            onUndo={(propId) => {
              void propAssetActions.revertRender({ id: propId }).catch(() => undefined)
            }}
            onImageClick={setPreviewImage}
            onCopyFromGlobal={handleCopyPropFromGlobal}
            filterIds={null}
          />
      )}

      <ProjectAssetLibraryModals
        projectId={projectId}
        onRefresh={onRefresh}
        onClosePreview={() => setPreviewImage(null)}
        handleGenerateImage={handleGenerateImage}
        handleUpdateAppearanceDescription={handleUpdateAppearanceDescription}
        handleUpdateLocationDescription={handleUpdateLocationDescription}
        handleCloseCopyPicker={handleCloseCopyPicker}
        handleConfirmCopyFromGlobal={handleConfirmCopyFromGlobal}
        closeEditingAppearance={closeEditingAppearance}
        closeEditingLocation={closeEditingLocation}
        closeEditingProp={closeEditingProp}
        closeAddCharacter={closeAddCharacter}
        closeAddLocation={closeAddLocation}
        closeAddProp={closeAddProp}
        previewImage={previewImage}
        editingAppearance={editingAppearance}
        editingLocation={editingLocation}
        editingProp={editingProp}
        showAddCharacter={showAddCharacter}
        showAddLocation={showAddLocation}
        showAddProp={showAddProp}
        copyFromGlobalTarget={copyFromGlobalTarget}
        isGlobalCopyInFlight={isGlobalCopyInFlight}
      />
    </div>
  )
}
