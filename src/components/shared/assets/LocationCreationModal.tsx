'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { shouldShowError } from '@/lib/error-utils'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import {
    useCreateAssetHubLocation,
    useCreateProjectLocation,
} from '@/lib/query/hooks'

export interface LocationCreationModalProps {
    mode: 'asset-hub' | 'project'
    // Asset Hub 模式使用
    folderId?: string | null
    // 项目模式使用
    projectId?: string
    onClose: () => void
    onSuccess: () => void
}

// 内联 SVG 图标
const XMarkIcon = ({ className }: { className?: string }) => (
    <AppIcon name="close" className={className} />
)

export function LocationCreationModal({
    mode,
    folderId,
    projectId,
    onClose,
    onSuccess
}: LocationCreationModalProps) {
    const t = useTranslations('assetModal')
    const createAssetHubLocation = useCreateAssetHubLocation()
    const createProjectLocation = useCreateProjectLocation(projectId || '')

    // 表单字段
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')

    const [isSubmitting, setIsSubmitting] = useState(false)
    const submittingState = isSubmitting
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'generate',
            resource: 'image',
            hasOutput: false,
        })
        : null

    const getErrorMessage = (error: unknown, fallback: string) => {
        if (error instanceof Error && error.message) {
            return error.message
        }
        return fallback
    }

    const getErrorStatus = (error: unknown): number | null => {
        if (typeof error === 'object' && error !== null) {
            const status = (error as { status?: unknown }).status
            if (typeof status === 'number') return status
        }
        return null
    }

    // ESC 键关闭
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isSubmitting) {
                onClose()
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [onClose, isSubmitting])

    // 提交创建
    const handleSubmit = async () => {
        if (!name.trim() || !description.trim()) return

        try {
            setIsSubmitting(true)

            const body: {
                name: string
                description: string
                folderId?: string | null
            } = {
                name: name.trim(),
                description: description.trim(),
            }

            if (mode === 'asset-hub') {
                body.folderId = folderId
            }

            if (mode === 'asset-hub') {
                await createAssetHubLocation.mutateAsync({
                    name: body.name,
                    summary: body.description,
                    folderId: body.folderId ?? null,
                })
            } else {
                await createProjectLocation.mutateAsync({
                    name: body.name,
                    description: body.description,
                })
            }

            onSuccess()
            onClose()
        } catch (error: unknown) {
            if (getErrorStatus(error) === 402) {
                alert(getErrorMessage(error, t('errors.insufficientBalance')))
            } else if (shouldShowError(error)) {
                alert(getErrorMessage(error, t('errors.createFailed')))
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    // 处理点击遮罩层关闭
    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget && !isSubmitting) {
            onClose()
        }
    }

    return (
        <div
            className="fixed inset-0 glass-overlay flex items-center justify-center z-50 p-4"
            onClick={handleBackdropClick}
        >
            <div className="glass-surface-modal max-w-2xl w-full max-h-[85vh] flex flex-col">
                <div className="p-6 overflow-y-auto flex-1">
                    {/* 标题 */}
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">
                            {t('location.title')}
                        </h3>
                        <button
                            onClick={onClose}
                            className="glass-btn-base glass-btn-soft w-8 h-8 rounded-full flex items-center justify-center text-[var(--glass-text-tertiary)]"
                        >
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="space-y-5">
                        {/* 场景名称 */}
                        <div className="space-y-2">
                            <label className="glass-field-label block">
                                {t('location.name')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('location.namePlaceholder')}
                                className="glass-input-base w-full px-3 py-2 text-sm"
                            />
                        </div>

                        {/* 场景描述 */}
                        <div className="space-y-2">
                            <label className="glass-field-label block">
                                {t('location.description')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t('location.descPlaceholder')}
                                className="glass-textarea-base w-full h-36 px-3 py-2 text-sm resize-none"
                            />
                        </div>
                    </div>
                </div>

                {/* 固定底部按钮区 */}
                <div className="flex gap-3 justify-end p-4 border-t border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] rounded-b-xl flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="glass-btn-base glass-btn-secondary px-4 py-2 rounded-lg text-sm"
                        disabled={isSubmitting}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !name.trim() || !description.trim()}
                        className="glass-btn-base glass-btn-primary px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center gap-2"
                    >
                        {isSubmitting ? (
                            <TaskStatusInline state={submittingState} className="text-white [&>span]:text-white [&_svg]:text-white" />
                        ) : (
                            <span>{t('common.add')}</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
