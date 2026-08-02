'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { useAssetActions } from '@/lib/query/hooks'

export interface PropEditModalProps {
  propId: string
  propName: string
  summary: string
  description: string
  variantId?: string
  onClose: () => void
}

export function PropEditModal({
  propId,
  propName,
  summary,
  description,
  variantId,
  onClose,
}: PropEditModalProps) {
  const t = useTranslations('assets')
  const actions = useAssetActions({
    kind: 'prop',
  })
  const [editingName, setEditingName] = useState(propName)
  const [editingSummary, setEditingSummary] = useState(summary)
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
  const persist = async () => {
    await actions.update(propId, {
      name: editingName.trim(),
      summary: editingSummary.trim(),
    })
    if (variantId) {
      await actions.updateVariant(propId, variantId, {
        description: editingDescription.trim(),
      })
    }
  }

  const handleSaveOnly = async () => {
    if (!editingName.trim() || !editingSummary.trim() || !editingDescription.trim()) return
    try {
      setIsSaving(true)
      await persist()
      onClose()
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
              {t('modal.editProp')} - {propName}
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
              {t('prop.name')}
            </label>
            <input
              type="text"
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              className="glass-input-base w-full px-3 py-2"
              placeholder={t('modal.namePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <label className="glass-field-label block">
              {t('prop.summary')}
            </label>
            <textarea
              value={editingSummary}
              onChange={(event) => setEditingSummary(event.target.value)}
              className="glass-textarea-base h-28 w-full px-3 py-2 resize-none"
              placeholder={t('prop.summaryPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <label className="glass-field-label block">
              {t('prop.description')}
            </label>
            <textarea
              value={editingDescription}
              onChange={(event) => setEditingDescription(event.target.value)}
              className="glass-textarea-base h-48 w-full px-3 py-2 resize-none"
              placeholder={t('prop.descriptionPlaceholder')}
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
            onClick={() => void handleSaveOnly()}
            disabled={isSaving || !editingName.trim() || !editingSummary.trim() || !editingDescription.trim()}
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
