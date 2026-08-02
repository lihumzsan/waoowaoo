'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import JSZip from 'jszip'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import { FolderSidebar } from './components/FolderSidebar'
import { AssetGrid } from './components/AssetGrid'
import { CharacterCreationModal, LocationCreationModal, PropCreationModal, CharacterEditModal, LocationEditModal, PropEditModal } from '@/components/shared/assets'
import { FolderModal } from './components/FolderModal'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import {
    useAssets,
    useGlobalFolders,
    useSSE,
} from '@/lib/query/hooks'
import { AppIcon } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'
import {
    requestOperationMutationVoidWithError,
} from '@/lib/query/mutations/mutation-shared'
import { useToast } from '@/contexts/ToastContext'

export default function AssetHubPage() {
    const t = useTranslations('assetHub')
    const queryClient = useQueryClient()
    const { showError, showToast } = useToast()

    // 文件夹选择状态
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)

    // 使用 React Query 获取数据
    const { data: folders = [], isLoading: foldersLoading } = useGlobalFolders()
    const { data: assets = [], isLoading: assetsLoading } = useAssets({
        scope: 'global',
        folderId: selectedFolderId,
    })
    const loading = foldersLoading || assetsLoading
    useSSE({ projectId: GLOBAL_ASSET_PROJECT_ID, enabled: true })

    // 弹窗状态
    const [showAddCharacter, setShowAddCharacter] = useState(false)
    const [showAddLocation, setShowAddLocation] = useState(false)
    const [showAddProp, setShowAddProp] = useState(false)
    const [showFolderModal, setShowFolderModal] = useState(false)
    const [editingFolder, setEditingFolder] = useState<{ id: string; name: string } | null>(null)
    const [previewImage, setPreviewImage] = useState<string | null>(null)

    const [isDownloading, setIsDownloading] = useState(false)


    // 编辑角色弹窗状态
    const [characterEditModal, setCharacterEditModal] = useState<{
        characterId: string
        characterName: string
        appearanceIndex: number
        changeReason: string
        description: string
    } | null>(null)

    // 编辑场景弹窗状态
    const [locationEditModal, setLocationEditModal] = useState<{
        locationId: string
        locationName: string
        summary: string
        imageIndex: number
        description: string
    } | null>(null)
    const [propEditModal, setPropEditModal] = useState<{
        propId: string
        propName: string
        summary: string
        description: string
        variantId?: string
    } | null>(null)

    // 创建文件夹
    const handleCreateFolder = async (name: string) => {
        try {
            await requestOperationMutationVoidWithError(
                '/api/asset-hub/folders',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                },
                queryClient,
            )
            setShowFolderModal(false)
        } catch (error) {
            _ulogError('创建文件夹失败:', error)
            showError(error, t('folderCreateFailed'))
        }
    }

    // 更新文件夹
    const handleUpdateFolder = async (folderId: string, name: string) => {
        try {
            await requestOperationMutationVoidWithError(
                `/api/asset-hub/folders/${folderId}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                },
                queryClient,
            )
            setEditingFolder(null)
            setShowFolderModal(false)
        } catch (error) {
            _ulogError('更新文件夹失败:', error)
            showError(error, t('folderUpdateFailed'))
        }
    }

    // 删除文件夹
    const handleDeleteFolder = async (folderId: string) => {
        if (!confirm(t('confirmDeleteFolder'))) return

        try {
            await requestOperationMutationVoidWithError(
                `/api/asset-hub/folders/${folderId}`,
                { method: 'DELETE' },
                queryClient,
            )
            if (selectedFolderId === folderId) {
                setSelectedFolderId(null)
            }
        } catch (error) {
            _ulogError('删除文件夹失败:', error)
            showError(error, t('folderDeleteFailed'))
        }
    }

    // 打开角色编辑弹窗
    const handleOpenCharacterEdit = (character: unknown, appearance: unknown) => {
        const typedCharacter = character as {
            id: string
            name: string
            appearances: Array<{
                id: string
                appearanceIndex: number
                changeReason: string
                description: string | null
            }>
        }
        const typedAppearance = appearance as {
            id: string
            appearanceIndex: number
            changeReason: string
            description: string | null
        }
        setCharacterEditModal({
            characterId: typedCharacter.id,
            characterName: typedCharacter.name,
            appearanceIndex: typedAppearance.appearanceIndex,
            changeReason: typedAppearance.changeReason || t('appearanceLabel', { index: typedAppearance.appearanceIndex }),
            description: typedAppearance.description || ''
        })
    }

    // 打开场景编辑弹窗
    const handleOpenLocationEdit = (location: unknown, imageIndex: number) => {
        const typedLocation = location as {
            id: string
            name: string
            summary: string | null
            images: Array<{ imageIndex: number; description: string | null }>
        }
        const image = typedLocation.images.find(img => img.imageIndex === imageIndex)
        setLocationEditModal({
            locationId: typedLocation.id,
            locationName: typedLocation.name,
            summary: typedLocation.summary || '',
            imageIndex: imageIndex,
            description: image?.description || typedLocation.summary || ''
        })
    }

    const handleOpenPropEdit = (prop: unknown, imageIndex: number) => {
        const typedProp = prop as {
            id: string
            name: string
            summary: string | null
            images: Array<{ id: string; imageIndex: number; description: string | null }>
        }
        const variant = typedProp.images.find((image) => image.imageIndex === imageIndex)
        setPropEditModal({
            propId: typedProp.id,
            propName: typedProp.name,
            summary: typedProp.summary || '',
            description: variant?.description || typedProp.summary || '',
            variantId: variant?.id,
        })
    }

    // 打包下载所有图片资产
    const handleDownloadAll = async () => {
        // 收集所有有效图片
        const imageEntries: Array<{ filename: string; url: string }> = []

        // 角色图片：每个角色每个外貌的当前选中图
        for (const asset of assets) {
            if (asset.kind !== 'character') continue
            for (const variant of asset.variants) {
                const selectedRender = variant.renders.find((render) => render.isSelected) ?? variant.renders[0]
                const url = selectedRender?.imageUrl
                if (!url) continue
                const safeName = asset.name.replace(/[/\\:*?"<>|]/g, '_')
                const filename = variant.index === 0
                    ? `characters/${safeName}.jpg`
                    : `characters/${safeName}_appearance${variant.index}.jpg`
                imageEntries.push({ filename, url })
            }
        }

        // 场景图片：每个场景的选中图
        for (const asset of assets) {
            if (asset.kind !== 'location') continue
            for (const variant of asset.variants) {
                const render = variant.renders[0]
                const url = render?.imageUrl
                if (!url) continue
                const safeName = asset.name.replace(/[/\\:*?"<>|]/g, '_')
                const filename = asset.variants.length <= 1
                    ? `locations/${safeName}.jpg`
                    : `locations/${safeName}_${variant.index + 1}.jpg`
                imageEntries.push({ filename, url })
            }
        }

        for (const asset of assets) {
            if (asset.kind !== 'prop') continue
            for (const variant of asset.variants) {
                const render = variant.renders[0]
                const url = render?.imageUrl
                if (!url) continue
                const safeName = asset.name.replace(/[/\\:*?"<>|]/g, '_')
                const filename = asset.variants.length <= 1
                    ? `props/${safeName}.jpg`
                    : `props/${safeName}_${variant.index + 1}.jpg`
                imageEntries.push({ filename, url })
            }
        }

        if (imageEntries.length === 0) {
            showToast(t('downloadEmpty'), 'warning')
            return
        }

        setIsDownloading(true)
        try {
            const zip = new JSZip()
            // 并发 fetch 所有图片
            await Promise.all(
                imageEntries.map(async ({ filename, url }) => {
                    try {
                        const response = await fetch(url)
                        if (!response.ok) return
                        const blob = await response.blob()
                        zip.file(filename, blob)
                    } catch {
                        // 单张图片失败不阻断整个流程
                    }
                })
            )
            const content = await zip.generateAsync({ type: 'blob' })
            const link = document.createElement('a')
            link.href = URL.createObjectURL(content)
            link.download = `asset-hub_${new Date().toISOString().slice(0, 10)}.zip`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(link.href)
        } catch (error) {
            _ulogError('打包下载失败:', error)
            showError(error, t('downloadFailed'))
        } finally {
            setIsDownloading(false)
        }
    }

    return (
        <div className="glass-page min-h-screen">
            <Navbar />
            <div className="max-w-7xl mx-auto px-4 py-6">
                {/* 页面标题 */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-[var(--glass-text-primary)]">{t('title')}</h1>
                    <p className="text-sm text-[var(--glass-text-secondary)] mt-1">{t('description')}</p>
                    <p className="text-xs text-[var(--glass-text-tertiary)] mt-2 flex items-center gap-1">
                        <AppIcon name="info" className="w-3.5 h-3.5" />
                        {t('modelHint')}
                        <Link href={{ pathname: '/profile' }} className="text-[var(--glass-tone-info-fg)] hover:underline">{t('modelHintLink')}</Link>
                        {t('modelHintSuffix')}
                    </p>
                </div>

                <div className="flex gap-6">
                    {/* 左侧文件夹树 */}
                    <FolderSidebar
                        folders={folders}
                        selectedFolderId={selectedFolderId}
                        onSelectFolder={setSelectedFolderId}
                        onCreateFolder={() => {
                            setEditingFolder(null)
                            setShowFolderModal(true)
                        }}
                        onEditFolder={(folder) => {
                            setEditingFolder(folder)
                            setShowFolderModal(true)
                        }}
                        onDeleteFolder={handleDeleteFolder}
                    />

                    {/* 右侧资产网格 */}
                    <AssetGrid
                        assets={assets}
                        loading={loading}
                        onAddCharacter={() => setShowAddCharacter(true)}
                        onAddLocation={() => setShowAddLocation(true)}
                        onAddProp={() => setShowAddProp(true)}
                        onDownloadAll={handleDownloadAll}
                        isDownloading={isDownloading}
                        selectedFolderId={selectedFolderId}
                        onImageClick={setPreviewImage}
                        onCharacterEdit={handleOpenCharacterEdit}
                        onLocationEdit={handleOpenLocationEdit}
                        onPropEdit={handleOpenPropEdit}
                    />
                </div>
            </div>

            {/* 新建角色弹窗 */}
            {showAddCharacter && (
                <CharacterCreationModal
                    folderId={selectedFolderId}
                    onClose={() => setShowAddCharacter(false)}
                    onSuccess={() => setShowAddCharacter(false)}
                />
            )}

            {/* 新建场景弹窗 */}
            {showAddLocation && (
                <LocationCreationModal
                    folderId={selectedFolderId}
                    onClose={() => setShowAddLocation(false)}
                    onSuccess={() => setShowAddLocation(false)}
                />
            )}

            {showAddProp && (
                <PropCreationModal
                    folderId={selectedFolderId}
                    onClose={() => setShowAddProp(false)}
                    onSuccess={() => setShowAddProp(false)}
                />
            )}

            {/* 文件夹编辑弹窗 */}
            {showFolderModal && (
                <FolderModal
                    folder={editingFolder}
                    onClose={() => {
                        setShowFolderModal(false)
                        setEditingFolder(null)
                    }}
                    onSave={(name) => {
                        if (editingFolder) {
                            handleUpdateFolder(editingFolder.id, name)
                        } else {
                            handleCreateFolder(name)
                        }
                    }}
                />
            )}

            {/* 图片预览弹窗 */}
            {previewImage && (
                <ImagePreviewModal
                    imageUrl={previewImage}
                    onClose={() => setPreviewImage(null)}
                />
            )}

            {/* 角色编辑弹窗 */}
            {characterEditModal && (
                <CharacterEditModal
                    characterId={characterEditModal.characterId}
                    characterName={characterEditModal.characterName}
                    appearanceIndex={characterEditModal.appearanceIndex}
                    changeReason={characterEditModal.changeReason}
                    description={characterEditModal.description}
                    onClose={() => setCharacterEditModal(null)}
                />
            )}

            {/* 场景编辑弹窗 */}
            {locationEditModal && (
                <LocationEditModal
                    locationId={locationEditModal.locationId}
                    locationName={locationEditModal.locationName}
                    summary={locationEditModal.summary}
                    description={locationEditModal.description}
                    onClose={() => setLocationEditModal(null)}
                />
            )}

            {propEditModal && (
                <PropEditModal
                    propId={propEditModal.propId}
                    propName={propEditModal.propName}
                    summary={propEditModal.summary}
                    description={propEditModal.description}
                    variantId={propEditModal.variantId}
                    onClose={() => setPropEditModal(null)}
                />
            )}

        </div>
    )
}
