'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import {
  MediaAttachmentChips,
  TextAttachmentChips,
} from '@/components/project-assistant/AttachmentChips'
import { submitFromEnterKey } from '@/lib/ui/keyboard-submit'
import type { ProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments'
import type { ProjectAssistantMediaAttachment } from '@/lib/project-agent/media-attachments'
import { isProjectAssistantMediaFile } from '@/lib/project-agent/media-attachments/client'
import type { WorkspaceAssistantFailureView } from './workspace-assistant-panel-state'

interface WorkspaceAssistantComposerProps {
  readonly value: string
  /**
   * Already-resolved failure view. A failed send must be unmissable: the user's
   * message bubble stays in the thread without a reply, so the panel resolves
   * the real reason once and the composer only renders it.
   */
  readonly error: WorkspaceAssistantFailureView | null
  readonly pending: boolean
  readonly canStopReply: boolean
  readonly attachments: readonly ProjectAssistantTextAttachment[]
  readonly mediaAttachments?: readonly ProjectAssistantMediaAttachment[]
  readonly attachDisabled?: boolean
  readonly mediaUploadPending?: boolean
  readonly mediaUploadFailed?: boolean
  readonly onChange: (value: string) => void
  readonly onSubmit: () => Promise<void>
  readonly onStopReply: () => Promise<void>
  readonly onAttachClick: () => void
  readonly onRemoveAttachment: (attachmentId: string) => void
  readonly onRemoveMediaAttachment?: (resourceId: string) => void
  readonly onPasteMediaFiles?: (files: readonly File[]) => void
}

export function WorkspaceAssistantComposer({
  value,
  error,
  pending,
  canStopReply,
  attachments,
  mediaAttachments = [],
  attachDisabled = false,
  mediaUploadPending = false,
  mediaUploadFailed = false,
  onChange,
  onSubmit,
  onStopReply,
  onAttachClick,
  onRemoveAttachment,
  onRemoveMediaAttachment,
  onPasteMediaFiles,
}: WorkspaceAssistantComposerProps) {
  const t = useTranslations('assistantAgent')

  return (
    <div>
      <div className="flex flex-col rounded-[22px] border border-[var(--glass-stroke-base)] bg-white/95 px-4 pb-2.5 pt-3 shadow-[0_6px_20px_rgba(15,23,42,0.07)]">
        <textarea
          rows={2}
          value={value}
          disabled={pending}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('panel.composerPlaceholder')}
          onKeyDown={(event) => {
            submitFromEnterKey(event, () => {
              void onSubmit()
            })
          }}
          onPaste={(event) => {
            if (!onPasteMediaFiles || pending) return
            const files = Array.from(event.clipboardData?.files ?? []).filter(
              isProjectAssistantMediaFile,
            )
            if (files.length === 0) return
            event.preventDefault()
            onPasteMediaFiles(files)
          }}
          className="min-h-10 max-h-[7rem] w-full resize-none overflow-y-auto bg-transparent pr-1 text-base leading-6 text-[var(--glass-text-primary)] outline-none [field-sizing:content] placeholder:text-[var(--glass-text-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
        />
        <TextAttachmentChips
          attachments={attachments}
          onRemove={pending ? undefined : onRemoveAttachment}
          className={attachments.length > 0 ? 'mt-2' : undefined}
        />
        <MediaAttachmentChips
          attachments={mediaAttachments}
          onRemove={pending ? undefined : onRemoveMediaAttachment}
          className={mediaAttachments.length > 0 ? 'mt-2' : undefined}
        />
        {mediaUploadPending ? (
          <div className="mt-2 inline-flex items-center gap-2 self-start rounded-lg border border-[var(--glass-stroke-base)] bg-white/90 px-2.5 py-1.5 text-xs leading-none text-[var(--glass-text-secondary)] shadow-sm">
            <AppIcon
              name="loader"
              className="h-3.5 w-3.5 animate-spin text-[var(--glass-tone-info-fg)]"
              aria-hidden="true"
            />
            {t('attachments.mediaUploading')}
          </div>
        ) : null}
        {mediaUploadFailed ? (
          <p
            role="alert"
            className="mt-2 rounded-lg bg-[var(--glass-tone-danger-bg)] px-2.5 py-1.5 text-xs leading-4 text-[var(--glass-tone-danger-fg)]"
          >
            {t('attachments.mediaUploadFailed')}
          </p>
        ) : null}
        <div className="mt-1 flex h-8 shrink-0 items-center justify-between gap-2">
          <div className="flex items-center">
            <button
              type="button"
              aria-label={t('attachments.openUpload')}
              title={t('attachments.openUpload')}
              disabled={pending || attachDisabled}
              onClick={onAttachClick}
              className="glass-selection-control inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--glass-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="plus" className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {canStopReply ? (
              <button
                type="button"
                aria-label={t('panel.stopGenerating')}
                title={t('panel.stopGenerating')}
                disabled={pending}
                onClick={() => {
                  void onStopReply()
                }}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--glass-stroke-base)] bg-white text-[var(--glass-text-primary)] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="h-2.5 w-2.5 rounded-[2px] bg-current" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              aria-label={t('panel.send')}
              disabled={
                (!value.trim() && attachments.length === 0 && mediaAttachments.length === 0) ||
                pending
              }
              onClick={() => {
                void onSubmit()
              }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--glass-text-primary)] text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <AppIcon name="arrowRight" className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      {error ? (
        <div
          role={error.tone === 'info' ? 'status' : 'alert'}
          className={
            error.tone === 'info'
              ? 'mt-1.5 rounded-lg bg-[var(--glass-tone-info-bg)] px-2.5 py-1.5 text-xs leading-4 text-[var(--glass-tone-info-fg)]'
              : 'mt-1.5 rounded-lg bg-[var(--glass-tone-danger-bg)] px-2.5 py-1.5 text-xs leading-4 text-[var(--glass-tone-danger-fg)]'
          }
        >
          <p className="font-medium">{error.headline}</p>
          {/* "Already handled" is an informative outcome: the protocol detail
              would only add noise to a state the user cannot act on. */}
          {error.tone === 'info' || !error.technical ? null : (
            <p className="mt-0.5 break-all text-xs leading-4 opacity-75">{error.technical}</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
