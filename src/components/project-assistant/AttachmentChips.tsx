'use client'

import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { ProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments'
import type { ProjectAssistantMediaAttachment } from '@/lib/project-agent/media-attachments'

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

export function TextAttachmentChips({
  attachments,
  onRemove,
  className,
}: {
  readonly attachments: readonly ProjectAssistantTextAttachment[]
  readonly onRemove?: (attachmentId: string) => void
  readonly className?: string
}) {
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

function MediaAttachmentRemoveButton({
  name,
  onRemove,
  floating,
}: {
  readonly name: string
  readonly onRemove: () => void
  readonly floating: boolean
}) {
  const t = useTranslations('assistantAgent')
  return (
    <button
      type="button"
      aria-label={t('attachments.removeFile', { fileName: name })}
      onClick={onRemove}
      className={floating
        ? 'absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/65 text-white transition hover:bg-slate-900/85'
        : 'ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--glass-text-tertiary)] transition hover:bg-slate-100 hover:text-[var(--glass-tone-danger-fg)]'}
    >
      <AppIcon name="close" className="h-3 w-3" aria-hidden="true" />
    </button>
  )
}

export function MediaAttachmentChips({
  attachments,
  onRemove,
  className,
}: {
  readonly attachments: readonly ProjectAssistantMediaAttachment[]
  readonly onRemove?: (resourceId: string) => void
  readonly className?: string
}) {
  const t = useTranslations('assistantAgent')
  if (attachments.length === 0) return null
  return (
    <div className={['flex flex-wrap items-center gap-2', className].filter(Boolean).join(' ')}>
      {attachments.map((attachment) => (
        attachment.mediaType === 'image' && attachment.href ? (
          <div
            key={attachment.resourceId}
            className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-[var(--glass-stroke-base)] bg-slate-100 shadow-sm"
            title={attachment.name}
          >
            {/* Protected same-origin media route; the session cookie authorizes the read. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.href}
              alt={attachment.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            {onRemove ? (
              <MediaAttachmentRemoveButton
                name={attachment.name}
                floating
                onRemove={() => onRemove(attachment.resourceId)}
              />
            ) : null}
          </div>
        ) : (
          <div
            key={attachment.resourceId}
            className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--glass-stroke-base)] bg-white/90 px-2.5 py-1.5 text-xs leading-none text-[var(--glass-text-secondary)] shadow-sm"
            title={attachment.name}
          >
            <AppIcon
              name={attachment.mediaType === 'image' ? 'image' : 'audioWave'}
              className="h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-info-fg)]"
              aria-hidden="true"
            />
            <span className="min-w-0 max-w-[12rem] truncate font-medium text-[var(--glass-text-primary)]">
              {attachment.name}
            </span>
            <span className="shrink-0 text-[11px] text-[var(--glass-text-tertiary)]">
              {t(attachment.mediaType === 'image' ? 'attachments.mediaKindImage' : 'attachments.mediaKindAudio')}
            </span>
            {onRemove ? (
              <MediaAttachmentRemoveButton
                name={attachment.name}
                floating={false}
                onRemove={() => onRemove(attachment.resourceId)}
              />
            ) : null}
          </div>
        )
      ))}
    </div>
  )
}

export interface PendingMediaFileChip {
  readonly id: string
  readonly fileName: string
  readonly isImage: boolean
  readonly previewUrl: string | null
}

/**
 * Pre-upload media chips for surfaces where the file is still local (Home,
 * before the project exists). Visually identical to MediaAttachmentChips so
 * the two states read as one attachment experience.
 */
export function PendingMediaFileChips({
  files,
  onRemove,
  className,
}: {
  readonly files: readonly PendingMediaFileChip[]
  readonly onRemove?: (id: string) => void
  readonly className?: string
}) {
  const t = useTranslations('assistantAgent')
  if (files.length === 0) return null
  return (
    <div className={['flex flex-wrap items-center gap-2', className].filter(Boolean).join(' ')}>
      {files.map((file) => (
        file.isImage && file.previewUrl ? (
          <div
            key={file.id}
            className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-[var(--glass-stroke-base)] bg-slate-100 shadow-sm"
            title={file.fileName}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={file.previewUrl} alt={file.fileName} className="h-full w-full object-cover" />
            {onRemove ? (
              <MediaAttachmentRemoveButton
                name={file.fileName}
                floating
                onRemove={() => onRemove(file.id)}
              />
            ) : null}
          </div>
        ) : (
          <div
            key={file.id}
            className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--glass-stroke-base)] bg-white/90 px-2.5 py-1.5 text-xs leading-none text-[var(--glass-text-secondary)] shadow-sm"
            title={file.fileName}
          >
            <AppIcon
              name={file.isImage ? 'image' : 'audioWave'}
              className="h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-info-fg)]"
              aria-hidden="true"
            />
            <span className="min-w-0 max-w-[12rem] truncate font-medium text-[var(--glass-text-primary)]">
              {file.fileName}
            </span>
            <span className="shrink-0 text-[11px] text-[var(--glass-text-tertiary)]">
              {t(file.isImage ? 'attachments.mediaKindImage' : 'attachments.mediaKindAudio')}
            </span>
            {onRemove ? (
              <MediaAttachmentRemoveButton
                name={file.fileName}
                floating={false}
                onRemove={() => onRemove(file.id)}
              />
            ) : null}
          </div>
        )
      ))}
    </div>
  )
}
