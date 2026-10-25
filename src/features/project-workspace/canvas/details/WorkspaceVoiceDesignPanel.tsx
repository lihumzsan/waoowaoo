'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import GlassInput from '@/components/ui/primitives/GlassInput'
import GlassSelect from '@/components/ui/primitives/GlassSelect'
import GlassTextarea from '@/components/ui/primitives/GlassTextarea'
import {
  VOICE_DESIGN_DESCRIPTION_MAX_CHARS,
  VOICE_DESIGN_LANGUAGE_OPTIONS,
  VOICE_DESIGN_TEXT_MAX_CHARS,
  voiceDesignGenerationOptionsSchema,
} from '@/lib/voice/voice-design-contract'
import type { WorkspaceResourceVoiceDesignView } from '@/lib/workspace-resource/selection-contract'
import type { WorkspaceResourceStatus } from '@/lib/workspace-resource/contracts'
import { workspaceCanvasScrollableRegionProps } from '../canvas-scroll-lock'
import type { WorkspaceNodeDetailsActions } from './WorkspaceNodeDetailsCard'

/** Edits are a draft for a new candidate; the source audio and provenance stay frozen. */
export function WorkspaceVoiceDesignPanel({
  voice,
  resourceName,
  resourceStatus,
  modelName,
  audioUrl,
  busy,
  onOperation,
}: {
  readonly voice: WorkspaceResourceVoiceDesignView
  readonly resourceName: string
  readonly resourceStatus: WorkspaceResourceStatus
  readonly modelName: string | null
  readonly audioUrl: string | null
  readonly busy: boolean
  readonly onOperation: WorkspaceNodeDetailsActions['onOperation']
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.voiceDesign')
  const fieldLabels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  const fieldId = useId()
  const defaultName = () => {
    const now = new Date()
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part) => String(part).padStart(2, '0')).join('-')
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((part) => String(part).padStart(2, '0')).join('-')
    return t('candidateNameDefault', {
      name: (voice.character?.name ?? resourceName).slice(0, 60),
      time: `${date} ${time}-${String(now.getMilliseconds()).padStart(3, '0')}`,
    })
  }
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState(voice.description ?? '')
  const [previewText, setPreviewText] = useState(voice.previewText ?? '')
  const [language, setLanguage] = useState(voice.language)
  const candidateAction = voice.candidateAction
  const editable = candidateAction !== null && !busy
  const canGenerate = candidateAction !== null
    && name.trim().length > 0
    && description.trim().length > 0
    && previewText.trim().length > 0
    && language !== null
  const modified = description !== (voice.description ?? '')
    || previewText !== (voice.previewText ?? '')
    || language !== voice.language

  const generate = () => {
    if (!candidateAction || !canGenerate || language === null) return
    const item = candidateAction.input.request.items[0]
    onOperation({
      kind: 'voice_candidate',
      operationId: candidateAction.operationId,
      confirmation: 'none',
      execution: candidateAction.execution,
      input: {
        request: {
          ...candidateAction.input.request,
          items: [{
            ...item,
            references: item.references.map((reference) => ({ ...reference })),
            name,
            prompt: description,
            previewText,
            language,
          }],
        },
      },
    }, () => setName(defaultName()))
  }

  return (
    <section className="min-w-0 space-y-3 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-[var(--glass-text-primary)]">{t('title')}</h3>
          {voice.character ? (
            <p className="mt-1 break-words text-xs text-[var(--glass-text-secondary)]">
              {t('character', { name: voice.character.name })}
            </p>
          ) : null}
        </div>
        {modelName ? (
          <p className="min-w-0 break-words text-[11px] text-[var(--glass-text-tertiary)]" title={modelName}>
            {fieldLabels('generationModel')} · {modelName}
          </p>
        ) : null}
        {voice.isSelected ? (
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[var(--glass-tone-success-fg)] ring-1 ring-slate-200">
            {t('selected')}
          </span>
        ) : null}
      </div>

      {audioUrl ? (
        <audio src={audioUrl} aria-label={t('audioLabel', { name: resourceName })} controls preload="metadata" className="nodrag nowheel h-10 w-full min-w-0" />
      ) : (
        <p className="text-xs text-[var(--glass-text-tertiary)]">{t('audioUnavailable')}</p>
      )}

      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="block min-w-0 space-y-1.5" htmlFor={`${fieldId}-description`}>
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('description')}</span>
          <GlassTextarea
            {...workspaceCanvasScrollableRegionProps<HTMLTextAreaElement>()}
            id={`${fieldId}-description`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            readOnly={!editable}
            maxLength={VOICE_DESIGN_DESCRIPTION_MAX_CHARS}
            rows={4}
            className="nodrag nowheel w-full bg-white"
          />
        </label>
        <label className="block min-w-0 space-y-1.5" htmlFor={`${fieldId}-preview`}>
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('previewText')}</span>
          <GlassTextarea
            {...workspaceCanvasScrollableRegionProps<HTMLTextAreaElement>()}
            id={`${fieldId}-preview`}
            value={previewText}
            onChange={(event) => setPreviewText(event.target.value)}
            readOnly={!editable}
            maxLength={VOICE_DESIGN_TEXT_MAX_CHARS}
            rows={4}
            className="nodrag nowheel w-full bg-white"
          />
        </label>
      </div>

      <div className={`grid min-w-0 gap-3 ${candidateAction ? 'sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.5fr)]' : ''}`}>
        {candidateAction ? (
          <label className="block min-w-0 space-y-1.5" htmlFor={`${fieldId}-name`}>
            <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('candidateName')}</span>
            <GlassInput
              id={`${fieldId}-name`}
              density="compact"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              maxLength={300}
              className="nodrag w-full bg-white"
            />
          </label>
        ) : null}
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('language')}</p>
          <GlassSelect
            value={language ?? undefined}
            ariaLabel={t('language')}
            placeholder={t('languageUnavailable')}
            options={VOICE_DESIGN_LANGUAGE_OPTIONS.map((value) => ({ value, label: t(`languages.${value}`) }))}
            onValueChange={(value) => setLanguage(voiceDesignGenerationOptionsSchema.shape.language.parse(value))}
            disabled={!editable}
            triggerClassName="nodrag bg-white"
          />
        </div>
      </div>

      {candidateAction || modified ? (
        <p className="text-[11px] leading-5 text-[var(--glass-text-tertiary)]">
          {modified ? t('draftNotice') : t('editHint')}
        </p>
      ) : null}
      {resourceStatus === 'ready' && voice.selectUnavailableReason ? (
        <p className="text-xs leading-5 text-[var(--glass-tone-warning-fg)]">
          {t(`selectUnavailableReasons.${voice.selectUnavailableReason}`)}
        </p>
      ) : null}
      {candidateAction || voice.selectAction || modified ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          {candidateAction ? (
            <button type="button" disabled={busy || !canGenerate} onClick={generate} className="glass-btn-base glass-btn-secondary h-9 px-3 text-xs disabled:opacity-50">
              {t('generateCandidate')}
            </button>
          ) : null}
          {voice.selectAction ? (
            <button
              type="button"
              disabled={busy || modified}
              title={modified ? t('selectOriginalHint') : undefined}
              className="glass-btn-base glass-btn-primary h-9 px-3 text-xs disabled:opacity-50"
              onClick={() => {
                if (!voice.selectAction) return
                onOperation({
                  kind: 'select_voice', operationId: voice.selectAction.operationId, confirmation: 'none',
                  execution: voice.selectAction.execution,
                  input: { ...voice.selectAction.input },
                })
              }}
            >
              {t('selectVoice')}
            </button>
          ) : null}
          {modified ? (
            <button
              type="button"
              disabled={busy}
              className="glass-btn-base glass-btn-ghost h-9 px-3 text-xs disabled:opacity-50"
              onClick={() => {
                setDescription(voice.description ?? '')
                setPreviewText(voice.previewText ?? '')
                setLanguage(voice.language)
              }}
            >
              {t('resetDraft')}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
