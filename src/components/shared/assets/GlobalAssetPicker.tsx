'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import type {
  CharacterAssetSummary,
  LocationAssetSummary,
  PropAssetSummary,
} from '@/lib/assets/contracts'

interface GlobalAssetPickerProps {
    onClose: () => void
    onSelect: (globalAssetId: string) => void
    type: 'character' | 'location' | 'prop'
    loading?: boolean
}

/** 从 appearances 中提取预览图 URL */
function getCharacterPreview(char: CharacterAssetSummary): string | null {
    const primaryVariant = char.variants.find((variant) => variant.index === 0) || char.variants[0]
    if (!primaryVariant) return null
    const selectedRenderIndex = primaryVariant.selectionState.selectedRenderIndex
    const selectedRender = selectedRenderIndex !== null
        ? primaryVariant.renders.find((render) => render.index === selectedRenderIndex)
        : null
    return selectedRender?.imageUrl
        || primaryVariant.renders.find((render) => render.isSelected)?.imageUrl
        || primaryVariant.renders[0]?.imageUrl
        || null
}

/** 从 variants/renders 中提取预览图 URL */
function getVisualAssetPreview(asset: LocationAssetSummary | PropAssetSummary): string | null {
    const selectedVariant = asset.selectedVariantId
        ? asset.variants.find((variant) => variant.id === asset.selectedVariantId)
        : null
    const targetVariant = selectedVariant || asset.variants[0]
    if (!targetVariant) return null
    return targetVariant.renders.find((render) => render.isSelected)?.imageUrl
        || targetVariant.renders[0]?.imageUrl
        || null
}

// 内联 SVG 图标组件
const XMarkIcon = ({ className }: { className?: string }) => (
    <AppIcon name="close" className={className} />
)

const MagnifyingGlassIcon = ({ className }: { className?: string }) => (
    <AppIcon name="search" className={className} />
)

const UserIcon = ({ className }: { className?: string }) => (
    <AppIcon name="userAlt" className={className} />
)

const PhotoIcon = ({ className }: { className?: string }) => (
    <AppIcon name="image" className={className} />
)

const CheckCircleIcon = ({ className }: { className?: string }) => (
    <AppIcon name="badgeCheck" className={className} />
)


export default function GlobalAssetPicker({
    onClose,
    onSelect,
    type,
    loading: externalLoading
}: GlobalAssetPickerProps) {
    const t = useTranslations('assetPicker')

    // 轻量级查询：只查询当前 type，不附带任务状态
    const charactersQuery = useQuery({
        queryKey: ['global-assets', 'characters'],
        queryFn: async () => {
            const res = await apiFetch('/api/assets?scope=global&kind=character')
            if (!res.ok) throw new Error('Failed to fetch characters')
            const data = await res.json()
            return data.assets as CharacterAssetSummary[]
        },
        enabled: type === 'character',
    })
    const locationsQuery = useQuery({
        queryKey: ['global-assets', 'locations'],
        queryFn: async () => {
            const res = await apiFetch('/api/assets?scope=global&kind=location')
            if (!res.ok) throw new Error('Failed to fetch locations')
            const data = await res.json()
            return data.assets as LocationAssetSummary[]
        },
        enabled: type === 'location',
    })
    const propsQuery = useQuery({
        queryKey: ['global-assets', 'props'],
        queryFn: async () => {
            const res = await apiFetch('/api/assets?scope=global&kind=prop')
            if (!res.ok) throw new Error('Failed to fetch props')
            const data = await res.json()
            return data.assets as PropAssetSummary[]
        },
        enabled: type === 'prop',
    })
    const characters = (charactersQuery.data || []) as CharacterAssetSummary[]
    const locations = (locationsQuery.data || []) as LocationAssetSummary[]
    const props = (propsQuery.data || []) as PropAssetSummary[]
    const isLoading = type === 'character'
        ? charactersQuery.isFetching
        : type === 'location'
            ? locationsQuery.isFetching
            : propsQuery.isFetching
    const loadingState = isLoading
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'process',
            resource: 'image',
            hasOutput: false,
        })
        : null
    const copyingState = externalLoading
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'process',
            resource: 'image',
            hasOutput: false,
        })
        : null
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [previewImage, setPreviewImage] = useState<string | null>(null)

    const handleConfirm = () => {
        if (selectedId) {
            onSelect(selectedId)
        }
    }

    const filteredCharacters = characters.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const filteredLocations = locations.filter(l =>
        l.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const filteredProps = props.filter(l =>
        l.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const items = type === 'character'
        ? filteredCharacters
        : type === 'location'
            ? filteredLocations
            : filteredProps
    const hasNoAssets = type === 'character'
        ? characters.length === 0
        : type === 'location'
            ? locations.length === 0
            : props.length === 0

    if (typeof document === 'undefined') {
        return null
    }

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 glass-overlay flex items-center justify-center z-50"
        >
                <div className="glass-surface-modal w-[600px] max-h-[80vh] flex flex-col">
                {/* 头部 */}
                <div className="flex items-center justify-between px-6 py-4">
                    <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">
                        {type === 'character' ? t('selectCharacter') : type === 'location' ? t('selectLocation') : t('selectProp')}
                    </h2>
                    <button onClick={onClose} className="glass-btn-base glass-btn-soft text-[var(--glass-text-tertiary)]">
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* 搜索栏 */}
                <div className="px-6 pb-3">
                    <div className="relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-text-tertiary)]" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('searchPlaceholder')}
                            className="glass-input-base w-full pl-9 pr-4 py-2 text-sm"
                        />
                    </div>
                </div>

                {/* 资产列表 */}
                <div className="flex-1 overflow-y-auto p-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-40">
                            <TaskStatusInline state={loadingState} />
                        </div>
                    ) : hasNoAssets ? (
                        <div className="flex flex-col items-center justify-center h-40 text-[var(--glass-text-tertiary)]">
                            {type === 'character' ? (
                                <UserIcon className="w-12 h-12 mb-2" />
                            ) : (
                                <PhotoIcon className="w-12 h-12 mb-2" />
                            )}
                            <p>{t('noAssets')}</p>
                            <p className="text-sm mt-1">{t('createInAssetHub')}</p>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="flex items-center justify-center h-40 text-[var(--glass-text-tertiary)]">
                            <p>{t('noSearchResults')}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-3">
                            {type === 'character' ? (
                                filteredCharacters.map((char) => {
                                    const charPreview = getCharacterPreview(char)
                                    return (
                                        <div
                                            key={char.id}
                                            onClick={() => setSelectedId(char.id)}
                                            className={`relative cursor-pointer rounded-xl border-2 p-2 transition-all hover:shadow-md ${selectedId === char.id
                                                ? 'border-[var(--glass-stroke-strong)] bg-[var(--glass-tone-soft)]'
                                                : 'border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)]'
                                                }`}
                                        >
                                            {/* 选中标记 */}
                                            {selectedId === char.id && (
                                                <CheckCircleIcon className="absolute -top-2 -right-2 w-6 h-6 text-[var(--glass-tone-info-fg)] bg-[var(--glass-bg-surface)] rounded-full" />
                                            )}

                                            {/* 预览图 */}
                                            <div className="aspect-[3/2] rounded-lg overflow-hidden bg-[var(--glass-bg-muted)] mb-2 relative">
                                                {charPreview ? (
                                                    <MediaImageWithLoading
                                                        src={charPreview}
                                                        alt={char.name}
                                                        containerClassName="w-full h-full"
                                                        className="w-full h-full object-contain cursor-zoom-in"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setPreviewImage(charPreview)
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-[var(--glass-text-tertiary)]">
                                                        <PhotoIcon className="w-12 h-12" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* 名称 */}
                                            <div className="text-center">
                                                <p className="font-medium text-sm text-[var(--glass-text-primary)] truncate">{char.name}</p>
                                            </div>
                                        </div>
                                    )
                                })
                            ) : type === 'location' ? (
                                filteredLocations.map((loc) => {
                                    const locPreview = getVisualAssetPreview(loc)
                                    return (
                                        <div
                                            key={loc.id}
                                            onClick={() => setSelectedId(loc.id)}
                                            className={`relative cursor-pointer rounded-xl border-2 p-2 transition-all hover:shadow-md ${selectedId === loc.id
                                                ? 'border-[var(--glass-stroke-strong)] bg-[var(--glass-tone-soft)]'
                                                : 'border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)]'
                                                }`}
                                        >
                                            {/* 选中标记 */}
                                            {selectedId === loc.id && (
                                                <CheckCircleIcon className="absolute -top-2 -right-2 w-6 h-6 text-[var(--glass-tone-info-fg)] bg-[var(--glass-bg-surface)] rounded-full" />
                                            )}

                                            {/* 预览图 */}
                                            <div className="aspect-video rounded-lg overflow-hidden bg-[var(--glass-bg-muted)] mb-2 relative">
                                                {locPreview ? (
                                                    <MediaImageWithLoading
                                                        src={locPreview}
                                                        alt={loc.name}
                                                        containerClassName="w-full h-full"
                                                        className="w-full h-full object-cover cursor-zoom-in"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setPreviewImage(locPreview)
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-[var(--glass-text-tertiary)]">
                                                        <PhotoIcon className="w-12 h-12" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* 名称 */}
                                            <div className="text-center">
                                                <p className="font-medium text-sm text-[var(--glass-text-primary)] truncate">{loc.name}</p>
                                                <p className="text-xs text-[var(--glass-text-secondary)] mt-1">
                                                    {loc.variants.length} {t('images')}
                                                </p>
                                            </div>
                                        </div>
                                    )
                                })
                            ) : type === 'prop' ? (
                                filteredProps.map((prop) => {
                                    const propPreview = getVisualAssetPreview(prop)
                                    return (
                                        <div
                                            key={prop.id}
                                            onClick={() => setSelectedId(prop.id)}
                                            className={`relative cursor-pointer rounded-xl border-2 p-2 transition-all hover:shadow-md ${selectedId === prop.id
                                                ? 'border-[var(--glass-stroke-strong)] bg-[var(--glass-tone-soft)]'
                                                : 'border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)]'
                                                }`}
                                        >
                                            {selectedId === prop.id && (
                                                <CheckCircleIcon className="absolute -top-2 -right-2 w-6 h-6 text-[var(--glass-tone-info-fg)] bg-[var(--glass-bg-surface)] rounded-full" />
                                            )}
                                            <div className="aspect-video rounded-lg overflow-hidden bg-[var(--glass-bg-muted)] mb-2 relative">
                                                {propPreview ? (
                                                    <MediaImageWithLoading
                                                        src={propPreview}
                                                        alt={prop.name}
                                                        containerClassName="w-full h-full"
                                                        className="w-full h-full object-cover cursor-zoom-in"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setPreviewImage(propPreview)
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-[var(--glass-text-tertiary)]">
                                                        <PhotoIcon className="w-12 h-12" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-center">
                                                <p className="font-medium text-sm text-[var(--glass-text-primary)] truncate">{prop.name}</p>
                                                <p className="text-xs text-[var(--glass-text-secondary)] mt-1">
                                                    {prop.variants.length} {t('images')}
                                                </p>
                                            </div>
                                        </div>
                                    )
                                })
                            ) : null}
                        </div>
                    )}
                </div>

                {/* 底部按钮 */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)]">
                    <button
                        onClick={onClose}
                        className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm"
                    >
                        {t('cancel')}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!selectedId || externalLoading}
                        className="glass-btn-base glass-btn-primary px-4 py-2 text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {externalLoading && <TaskStatusInline state={copyingState} className="text-white [&>span]:sr-only [&_svg]:text-white" />}
                        {t('confirmCopy')}
                    </button>
                </div>
            </div>

            {/* 图片放大预览弹窗 */}
            {
                previewImage && (
                    <ImagePreviewModal
                        imageUrl={previewImage}
                        onClose={() => setPreviewImage(null)}
                    />
                )
            }
        </div>,
        document.body,
    )
}
