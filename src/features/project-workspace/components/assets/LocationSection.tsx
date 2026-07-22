'use client'
import { useTranslations } from 'next-intl'

/**
 * LocationSection - 场景资产区块组件
 * 从项目资产库模块提取，负责场景列表的展示和操作
 * 
 * 🔥 V6.5 重构：内部直接订阅 useProjectAssets，消除 props drilling
 */

import { Location, Prop } from '@/types/project'
import { useProjectAssets } from '@/lib/query/hooks/useProjectAssets'
import LocationCard from './LocationCard'
import { AppIcon } from '@/components/ui/icons'

interface LocationSectionProps {
    // 🔥 V6.5 删除：locations prop - 现在内部直接订阅
    projectId: string
    assetType?: 'location' | 'prop'
    // 回调函数
    onAddLocation: () => void
    onDeleteLocation: (locationId: string) => void
    onEditLocation: (location: Location | Prop) => void
    onSelectImage: (locationId: string, imageIndex: number | null) => void
    onConfirmSelection: (locationId: string) => Promise<void> | void
    onUndo: (locationId: string) => void
    onImageClick: (imageUrl: string) => void
    onCopyFromGlobal: (locationId: string) => void  // 🆕 从资产中心复制
    /** 分集筛选：仅显示指定 ID 的场景/道具，null 表示显示全部 */
    filterIds?: Set<string> | null
}

export default function LocationSection({
    // 🔥 V6.5 删除：locations prop - 现在内部直接订阅
    projectId,
    assetType = 'location',
    onAddLocation,
    onDeleteLocation,
    onEditLocation,
    onSelectImage,
    onConfirmSelection,
    onUndo,
    onImageClick,
    onCopyFromGlobal,
    filterIds = null,
}: LocationSectionProps) {
    const t = useTranslations('assets')

    const { data: assets } = useProjectAssets(projectId)
    const allLocations: Array<Location | Prop> = assetType === 'prop'
        ? assets?.props ?? []
        : assets?.locations ?? []
    const locations = filterIds ? allLocations.filter((l) => filterIds.has(l.id)) : allLocations
    const assetKey = assetType === 'prop' ? 'prop' : 'location'

    return (
        <div className="glass-surface p-6">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
                        <AppIcon name="imageLandscape" className="h-5 w-5" />
                    </span>
                    <h3 className="text-lg font-bold text-[var(--glass-text-primary)]">
                        {assetType === 'prop' ? t('overview.propAssets') : t("overview.locationAssets")}
                    </h3>
                    <span className="text-sm text-[var(--glass-text-tertiary)] bg-[var(--glass-bg-muted)]/50 px-2 py-1 rounded-lg">
                        {assetType === 'prop'
                            ? t('overview.propCounts', { count: locations.length })
                            : t("overview.locationCounts", { count: locations.length })}
                    </span>
                </div>
                <button
                    onClick={onAddLocation}
                    className="glass-btn-base glass-btn-primary flex items-center gap-2 px-4 py-2 font-medium"
                >
                    + {t(`${assetKey}.add`)}
                </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 xl:grid-cols-6 gap-6">
                {locations.map(location => (
                    <LocationCard
                        key={location.id}
                        location={location}
                        assetType={assetType}
                        onEdit={() => onEditLocation(location)}
                        onDelete={() => onDeleteLocation(location.id)}
                        onUndo={() => onUndo(location.id)}
                        onImageClick={onImageClick}
                        onSelectImage={onSelectImage}
                        onCopyFromGlobal={() => onCopyFromGlobal(location.id)}
                        projectId={projectId}
                        onConfirmSelection={onConfirmSelection}
                    />
                ))}
            </div>
        </div>
    )
}
