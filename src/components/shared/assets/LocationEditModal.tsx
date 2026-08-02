'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { shouldShowError } from '@/lib/error-utils'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import {
    useUpdateLocationName,
    useUpdateLocationSummary,
} from '@/lib/query/hooks'
import { useToast } from '@/contexts/ToastContext'

export interface LocationEditModalProps {
    locationId: string
    locationName: string
    description: string
    summary?: string
    onClose: () => void
    onUpdate?: (newDescription: string) => void
    onNameUpdate?: (newName: string) => void
}

export function LocationEditModal({
    locationId,
    locationName,
    description,
    summary,
    onClose,
    onUpdate,
    onNameUpdate,
}: LocationEditModalProps) {
    const t = useTranslations('assets')
    const { showError } = useToast()

    const [editingName, setEditingName] = useState(locationName)
    const [editingDescription, setEditingDescription] = useState(description || summary || '')
    const [isSaving, setIsSaving] = useState(false)
    const savingState = isSaving
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'process',
            resource: 'text',
            hasOutput: false,
        })
        : null

    const updateAssetHubName = useUpdateLocationName()
    const updateAssetHubSummary = useUpdateLocationSummary()

    const persistNameIfNeeded = async () => {
        const nextName = editingName.trim()
        if (!nextName || nextName === locationName) return

        await updateAssetHubName.mutateAsync({ locationId, name: nextName })
        onNameUpdate?.(nextName)
    }

    const persistDescription = async () => {
        await updateAssetHubSummary.mutateAsync({
            locationId,
            summary: editingDescription,
        })
    }

    const handleSaveName = async () => {
        try {
            await persistNameIfNeeded()
        } catch (error: unknown) {
            if (shouldShowError(error)) {
                showError(error, t('modal.saveName') + t('errors.failed'))
            }
        }
    }

    const handleSaveOnly = async () => {
        try {
            setIsSaving(true)
            await persistNameIfNeeded()
            await persistDescription()

            onUpdate?.(editingDescription)
            onClose()
        } catch (error: unknown) {
            if (shouldShowError(error)) {
                showError(error, t('errors.saveFailed'))
            }
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50 p-4">
            <div className="glass-surface-modal max-w-2xl w-full max-h-[80vh] flex flex-col">
                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">
                            {t('modal.editLocation')} - {locationName}
                        </h3>
                        <button
                            onClick={onClose}
                            className="glass-btn-base glass-btn-soft w-9 h-9 rounded-full text-[var(--glass-text-tertiary)]"
                        >
                            <AppIcon name="close" className="w-6 h-6" />
                        </button>
                    </div>

                    <div className="space-y-2">
                        <label className="glass-field-label block">
                            {t('location.name')}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                className="glass-input-base flex-1 px-3 py-2"
                                placeholder={t('modal.namePlaceholder')}
                            />
                            {editingName !== locationName && (
                                <button
                                    onClick={handleSaveName}
                                    disabled={updateAssetHubName.isPending || !editingName.trim()}
                                    className="glass-btn-base glass-btn-tone-success px-3 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm whitespace-nowrap"
                                >
                                    {updateAssetHubName.isPending
                                        ? t('modal.processing')
                                        : t('modal.saveName')}
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="glass-field-label block">
                            {t('location.description')}
                        </label>
                        <textarea
                            value={editingDescription}
                            onChange={(event) => setEditingDescription(event.target.value)}
                            className="glass-textarea-base w-full h-48 px-3 py-2 resize-none"
                            placeholder={t('modal.descPlaceholder')}
                        />
                    </div>
                </div>

                <div className="flex gap-3 justify-end p-4 border-t border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] rounded-b-lg flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="glass-btn-base glass-btn-secondary px-4 py-2 rounded-lg"
                        disabled={isSaving}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleSaveOnly}
                        disabled={isSaving || !editingDescription.trim()}
                        className="glass-btn-base glass-btn-tone-info px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSaving ? (
                            <TaskStatusInline state={savingState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                        ) : (
                            t('modal.save')
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
