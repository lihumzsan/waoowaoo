'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { MediaAttachmentChips, TextAttachmentChips } from '@/components/project-assistant/TextAttachmentUploadDialog'
import { submitFromEnterKey } from '@/lib/ui/keyboard-submit'
import type { ProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments'
import type { ProjectAssistantMediaAttachment } from '@/lib/project-agent/media-attachments'
import { isProjectAssistantMediaFile } from '@/lib/project-agent/media-attachments/client'

interface WorkspaceAssistantComposerProps {
  readonly value: string
  readonly error: string | null
  readonly pending: boolean
  readonly canStopReply: boolean
  readonly attachments: readonly ProjectAssistantTextAttachment[]
  readonly mediaAttachments?: readonly ProjectAssistantMediaAttachment[]
  readonly attachDisabled?: boolean
  readonly mediaUploadPending?: boolean
  readonly mediaUploadError?: string | null
  readonly onChange: (value: string) => void
  readonly onSubmit: () => Promise<void>
  readonly onStopReply: () => Promise<void>
  readonly onAttachClick: () => void
  readonly onRemoveAttachment: (attachmentId: string) => void
  readonly onRemoveMediaAttachment?: (revisionId: string) => void
  readonly onPasteMediaFiles?: (files: readonly File[]) => void
}

/**
 * Maps raw send-failure payloads (API error JSON, transport errors) to a
 * user-readable explanation. A failed send must be unmissable: the user's
 * message bubble stays in the thread without a reply, so a silent or truncated
 * error reads as "the assistant died".
 */
function isInsufficientBalanceErrorText(error: string): boolean {
  const normalized = error.toUpperCase()
  return normalized.includes('INSUFFICIENT_BALANCE') || normalized.includes('INSUFFICIENT_CREDITS')
}

function resolveComposerErrorMessageKey(
  error: string,
): 'panel.sendErrorBusy' | 'panel.sendErrorInsufficientBalance' | 'panel.cardResponseErrorGeneric' | 'panel.backgroundFollowUpErrorGeneric' | 'panel.sendErrorGeneric' {
  if (error.includes('PROJECT_AGENT_RUN_ACTIVE')) return 'panel.sendErrorBusy'
  if (isInsufficientBalanceErrorText(error)) return 'panel.sendErrorInsufficientBalance'
  if (error.includes('PROJECT_ASSISTANT_CARD_RESPONSE_FAILED')) return 'panel.cardResponseErrorGeneric'
  if (error.includes('PROJECT_ASSISTANT_BACKGROUND_FOLLOW_UP_FAILED')) return 'panel.backgroundFollowUpErrorGeneric'
  return 'panel.sendErrorGeneric'
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
  mediaUploadError = null,
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
            submitFromEnterKey(event, () => { void onSubmit() })
          }}
          onPaste={(event) => {
            if (!onPasteMediaFiles || pending) return
            const files = Array.from(event.clipboardData?.files ?? []).filter(isProjectAssistantMediaFile)
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
            <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin text-[var(--glass-tone-info-fg)]" aria-hidden="true" />
            {t('attachments.mediaUploading')}
          </div>
        ) : null}
        {mediaUploadError ? (
          <p role="alert" className="mt-2 rounded-lg bg-[var(--glass-tone-danger-bg)] px-2.5 py-1.5 text-xs leading-4 text-[var(--glass-tone-danger-fg)]">
            {t('attachments.mediaUploadFailed')}
            <span className="ml-1 break-all opacity-75">{mediaUploadError}</span>
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
          {canStopReply ? (
            <button
              type="button"
              aria-label={t('panel.stopGenerating')}
              title={t('panel.stopGenerating')}
              onClick={() => { void onStopReply() }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--glass-text-primary)] text-white transition hover:bg-slate-900"
            >
              <span className="h-2.5 w-2.5 rounded-[2px] bg-current" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t('panel.send')}
              disabled={(!value.trim() && attachments.length === 0 && mediaAttachments.length === 0) || pending}
              onClick={() => { void onSubmit() }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--glass-text-primary)] text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <AppIcon name="arrowRight" className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {error ? (
        <div
          role="alert"
          className="mt-1.5 rounded-lg bg-[var(--glass-tone-danger-bg)] px-2.5 py-1.5 text-xs leading-4 text-[var(--glass-tone-danger-fg)]"
        >
          <p className="font-medium">{t(resolveComposerErrorMessageKey(error))}</p>
          <p className="mt-0.5 break-all text-xs leading-4 opacity-75">{error}</p>
        </div>
      ) : null}
    </div>
  )
}
