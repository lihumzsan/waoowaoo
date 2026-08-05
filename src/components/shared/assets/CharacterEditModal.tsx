'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { shouldShowError } from '@/lib/error-utils'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import {
    useUpdateCharacterAppearanceDescription,
    useUpdateCharacterName,
} from '@/lib/query/hooks'
import { useToast } from '@/contexts/ToastContext'

export interface CharacterEditModalProps {
    characterId: string
    characterName: string
    description: string
    appearanceIndex?: number
    changeReason?: string
    onClose: () => void
    onUpdate?: (newDescription: string) => void
    onNameUpdate?: (newName: string) => void
}

export function CharacterEditModal({
    characterId,
    characterName,
    description,
    appearanceIndex,
    changeReason,
    onClose,
    onUpdate,
    onNameUpdate,
}: CharacterEditModalProps) {
    const t = useTranslations('assets')
    const { showError } = useToast()

    const [editingName, setEditingName] = useState(characterName)
    const [editingDescription, setEditingDescription] = useState(description)
    const [isSaving, setIsSaving] = useState(false)
    const savingState = isSaving
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'process',
            resource: 'text',
            hasOutput: false,
        })
        : null

    const updateAssetHubName = useUpdateCharacterName()
    const updateAssetHubAppearanceDesc = useUpdateCharacterAppearanceDescription()

    const persistNameIfNeeded = async () => {
        const nextName = editingName.trim()
        if (!nextName || nextName === characterName) return

        await updateAssetHubName.mutateAsync({ characterId, name: nextName })
        onNameUpdate?.(nextName)
    }

    const persistDescription = async () => {
        await updateAssetHubAppearanceDesc.mutateAsync({
            characterId,
            appearanceIndex: appearanceIndex ?? 0,
            description: editingDescription,
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
                            {t('modal.editCharacter')} - {characterName}
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
                            {t('character.name')}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                className="glass-input-base flex-1 px-3 py-2"
                                placeholder={t('modal.namePlaceholder')}
                            />
                            {editingName !== characterName && (
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

                    {changeReason && (
                        <div className="text-sm text-[var(--glass-text-secondary)]">
                            {t('character.appearance')}:
                            <span className="ml-1 inline-flex items-center rounded-full px-2 py-0.5 bg-[var(--glass-tone-neutral-bg)] text-[var(--glass-tone-neutral-fg)] shadow-[var(--glass-tone-shadow)]">
                                {changeReason}
                            </span>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="glass-field-label block">
                            {t('modal.appearancePrompt')}
                        </label>
                        <textarea
                            value={editingDescription}
                            onChange={(event) => setEditingDescription(event.target.value)}
                            className="glass-textarea-base w-full h-64 px-3 py-2 resize-none"
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
