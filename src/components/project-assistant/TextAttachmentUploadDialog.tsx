'use client'

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT,
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_CHARS,
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import { uploadProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments/client'

interface TextAttachmentUploadDialogProps {
  readonly open: boolean
  readonly disabled?: boolean
  readonly onClose: () => void
  readonly onUploaded: (attachment: ProjectAssistantTextAttachment) => void
}

interface TextAttachmentChipsProps {
  readonly attachments: readonly ProjectAssistantTextAttachment[]
  readonly onRemove?: (attachmentId: string) => void
  readonly className?: string
}

function formatBytes(value: number, locale: string): string {
  if (value < 1024) {
    return `${new Intl.NumberFormat(locale).format(value)} B`
  }
  const divisor = value >= 1024 * 1024 ? 1024 * 1024 : 1024
  const unit = value >= 1024 * 1024 ? 'MB' : 'KB'
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 1024 * 1024 ? 1 : 0,
  }).format(value / divisor) + ` ${unit}`
}

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value)
}

function fileFromList(files: FileList | null): File | null {
  return files && files.length > 0 ? files[0] ?? null : null
}

export function TextAttachmentChips({
  attachments,
  onRemove,
  className,
}: TextAttachmentChipsProps) {
  const t = useTranslations('assistantAgent')
  const locale = useLocale()
  if (attachments.length === 0) return null
  return (
    <div className={['flex flex-wrap gap-2', className].filter(Boolean).join(' ')}>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--glass-stroke-base)] bg-white/90 px-2.5 py-1.5 text-xs leading-none text-[var(--glass-text-secondary)] shadow-sm"
          title={attachment.fileName}
        >
          <AppIcon name="fileText" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-info-fg)]" aria-hidden="true" />
          <span className="min-w-0 max-w-[12rem] truncate font-medium text-[var(--glass-text-primary)]">
            {attachment.fileName}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--glass-text-tertiary)]">
            {t('attachments.fileMeta', {
              chars: formatCount(attachment.charCount, locale),
              size: formatBytes(attachment.sizeBytes, locale),
            })}
          </span>
          {onRemove ? (
            <button
              type="button"
              aria-label={t('attachments.removeFile', { fileName: attachment.fileName })}
              onClick={() => onRemove(attachment.id)}
              className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--glass-text-tertiary)] transition hover:bg-slate-100 hover:text-[var(--glass-tone-danger-fg)]"
            >
              <AppIcon name="close" className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function TextAttachmentUploadDialog({
  open,
  disabled = false,
  onClose,
  onUploaded,
}: TextAttachmentUploadDialogProps) {
  const t = useTranslations('assistantAgent')
  const locale = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uploading) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open, uploading])

  useEffect(() => {
    if (open) return
    setSelectedFile(null)
    setError(null)
    setDragActive(false)
    setUploading(false)
  }, [open])

  const selectFile = useCallback((file: File | null) => {
    setSelectedFile(file)
    setError(null)
  }, [])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    if (disabled || uploading) return
    selectFile(fileFromList(event.dataTransfer.files))
  }, [disabled, selectFile, uploading])

  const handleUpload = useCallback(async () => {
    if (!selectedFile || disabled || uploading) return
    setUploading(true)
    setError(null)
    try {
      const attachment = await uploadProjectAssistantTextAttachment({ file: selectedFile })
      onUploaded(attachment)
      onClose()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError))
    } finally {
      setUploading(false)
    }
  }, [disabled, onClose, onUploaded, selectedFile, uploading])

  if (!mounted || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('attachments.dialogTitle')}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--glass-text-tertiary)]">
              {t('attachments.dialogDescription', {
                maxSize: formatBytes(PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES, locale),
                maxChars: formatCount(PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_CHARS, locale),
              })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('attachments.closeDialog')}
            disabled={uploading}
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--glass-text-tertiary)] transition hover:bg-slate-100 hover:text-[var(--glass-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="close" className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault()
            if (!disabled && !uploading) setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={[
            'mt-4 flex min-h-[168px] flex-col items-center justify-center rounded-xl border border-dashed px-5 py-6 text-center transition',
            dragActive
              ? 'border-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)]'
              : 'border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/80',
          ].join(' ')}
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-[var(--glass-stroke-base)]">
            <AppIcon name="upload" className="h-5 w-5 text-[var(--glass-tone-info-fg)]" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-medium text-[var(--glass-text-primary)]">
            {selectedFile ? selectedFile.name : t('attachments.dropTitle')}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--glass-text-tertiary)]">
            {selectedFile
              ? t('attachments.selectedMeta', { size: formatBytes(selectedFile.size, locale) })
              : t('attachments.supportedTypes')}
          </p>
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
            className="glass-btn-base glass-btn-secondary mt-4 h-9 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="plus" className="h-3.5 w-3.5" aria-hidden="true" />
            {t('attachments.chooseFile')}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT}
            className="hidden"
            disabled={disabled || uploading}
            onChange={(event) => selectFile(fileFromList(event.target.files))}
          />
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-xs leading-5 text-[var(--glass-tone-danger-fg)]">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={onClose}
            className="glass-btn-base glass-btn-secondary h-9 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('attachments.cancel')}
          </button>
          <button
            type="button"
            disabled={!selectedFile || disabled || uploading}
            onClick={() => { void handleUpload() }}
            className="glass-btn-base glass-btn-primary h-9 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {uploading ? t('attachments.uploading') : t('attachments.attach')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
