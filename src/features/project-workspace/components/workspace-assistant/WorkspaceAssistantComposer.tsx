'use client'

import type { RefObject } from 'react'
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
import type { WorkspaceCanvasSelection } from '../../canvas/contracts/workspace-canvas-interactions'
import type { WorkspaceAssistantFailureView } from './workspace-assistant-panel-state'
import type { AssistantRuntimeCollaborationMode } from '@/lib/assistant-runtime/contracts'

interface WorkspaceAssistantComposerProps {
  readonly value: string
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>
  readonly selection: WorkspaceCanvasSelection | null
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
  readonly collaborationMode: AssistantRuntimeCollaborationMode
  readonly collaborationModeLocked: boolean
  readonly attachmentError?: string | null
  readonly onChange: (value: string) => void
  readonly onSubmit: () => Promise<void>
  readonly onStopReply: () => Promise<void>
  readonly onAttachClick: () => void
  readonly onRemoveAttachment: (attachmentId: string) => void
  readonly onRemoveMediaAttachment?: (resourceId: string) => void
  readonly onPasteMediaFiles?: (files: readonly File[]) => void
  readonly onClearSelection: () => void
  readonly onCollaborationModeChange: (mode: AssistantRuntimeCollaborationMode) => void
}

export function WorkspaceAssistantComposer({
  value,
  textareaRef,
  selection,
  error,
  pending,
  canStopReply,
  attachments,
  mediaAttachments = [],
  attachDisabled = false,
  mediaUploadPending = false,
  collaborationMode,
  collaborationModeLocked,
  attachmentError = null,
  onChange,
  onSubmit,
  onStopReply,
  onAttachClick,
  onRemoveAttachment,
  onRemoveMediaAttachment,
  onPasteMediaFiles,
  onClearSelection,
  onCollaborationModeChange,
}: WorkspaceAssistantComposerProps) {
  const t = useTranslations('assistantAgent')

  return (
    <div>
      <div className="flex flex-col rounded-2xl border border-white/70 bg-white/85 px-4 pb-2.5 pt-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_6px_20px_-8px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        {selection ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-[var(--glass-text-tertiary)] ring-1 ring-slate-200">
              {selection.previewUrl && selection.mediaType === 'image' ? (
                // The URL is a protected server View, never a raw storage key.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selection.previewUrl} alt="" className="h-full w-full object-cover" />
              ) : selection.previewUrl && selection.mediaType === 'video' ? (
                <video src={`${selection.previewUrl}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover" />
              ) : (
                <AppIcon
                  name={selection.mediaType === 'audio' ? 'audioWave' : selection.mediaType === 'text' ? 'fileText' : 'image'}
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[var(--glass-text-primary)]">{selection.name}</p>
              <p className="truncate text-[10px] text-[var(--glass-text-tertiary)]">
                {t(`canvasContext.mediaType.${selection.mediaType}`)} · {t('canvasContext.active')}
              </p>
            </div>
            <button
              type="button"
              aria-label={t('canvasContext.clear')}
              title={t('canvasContext.clear')}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--glass-text-tertiary)] hover:bg-white"
              onClick={onClearSelection}
            >
              <AppIcon name="close" className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
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
        {attachmentError ? (
          <p
            role="alert"
            className="mt-2 rounded-lg bg-[var(--glass-tone-danger-bg)] px-2.5 py-1.5 text-xs leading-4 text-[var(--glass-tone-danger-fg)]"
          >
            {attachmentError}
          </p>
        ) : null}
        <div className="mt-1 flex h-8 shrink-0 items-center justify-between gap-2">
          <div className="flex items-center gap-2">
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
            <div
              role="group"
              aria-label={t('panel.collaborationMode')}
              className="flex items-center rounded-lg bg-slate-100 p-0.5 text-[11px] font-medium"
            >
              {(['default', 'plan'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={pending || collaborationModeLocked}
                  aria-pressed={collaborationMode === mode}
                  onClick={() => onCollaborationModeChange(mode)}
                  className={`rounded-md px-2 py-1 transition-colors ${collaborationMode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {t(`panel.collaborationModes.${mode}`)}
                </button>
              ))}
            </div>
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
