'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { useAssetActions } from '@/lib/query/hooks'

export interface PropCreationModalProps {
  folderId?: string | null
  onClose: () => void
  onSuccess: () => void
}

export function PropCreationModal({
  folderId,
  onClose,
  onSuccess,
}: PropCreationModalProps) {
  const t = useTranslations('assetModal')
  const actions = useAssetActions({
    kind: 'prop',
  })
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingState = isSubmitting
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'process',
      resource: 'text',
      hasOutput: false,
    })
    : null

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isSubmitting, onClose])

  const handleSubmit = async () => {
    if (!name.trim() || !summary.trim() || !description.trim()) return
    try {
      setIsSubmitting(true)
      await actions.create({
        name: name.trim(),
        summary: summary.trim(),
        description: description.trim(),
        folderId,
      })
      onSuccess()
      onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50 p-4">
      <div className="glass-surface-modal max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="p-6 overflow-y-auto flex-1">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">
              {t('prop.title')}
            </h3>
            <button
              onClick={onClose}
              className="glass-btn-base glass-btn-soft w-8 h-8 rounded-full flex items-center justify-center text-[var(--glass-text-tertiary)]"
            >
              <AppIcon name="close" className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <label className="glass-field-label block">
                {t('prop.name')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('prop.namePlaceholder')}
                className="glass-input-base w-full px-3 py-2 text-sm"
              />
            </div>

          <div className="space-y-2">
            <label className="glass-field-label block">
              {t('prop.summary')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
              </label>
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder={t('prop.summaryPlaceholder')}
                className="glass-textarea-base w-full h-36 px-3 py-2 text-sm resize-none"
              />
            </div>

            <div className="space-y-2">
              <label className="glass-field-label block">
                {t('prop.description')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
              </label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('prop.descriptionPlaceholder')}
                className="glass-textarea-base w-full h-36 px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end p-4 border-t border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] rounded-b-xl flex-shrink-0">
          <button
            onClick={onClose}
            className="glass-btn-base glass-btn-secondary px-4 py-2 rounded-lg text-sm"
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || !name.trim() || !summary.trim() || !description.trim()}
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
