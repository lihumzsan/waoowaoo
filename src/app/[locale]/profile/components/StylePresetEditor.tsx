'use client'

import { useTranslations } from 'next-intl'
import type { VisualStyleConfig } from '@/lib/style-preset/types'
import { normalizePromptOnlyVisualStyleConfig } from '@/lib/style-preset/visual-config'
import type { DraftState } from './stylePresetEditorState'

type StylePresetEditorProps = {
  draft: DraftState
  error: string | null
  readOnly: boolean
  onNameChange: (value: string) => void
  onVisualConfigChange: (patch: Partial<VisualStyleConfig>) => void
}

export default function StylePresetEditor({
  draft,
  error,
  readOnly,
  onNameChange,
  onVisualConfigChange,
}: StylePresetEditorProps) {
  const t = useTranslations('profile.stylePresets')
  const visualConfig = draft.config as VisualStyleConfig
  const showEditableName = !readOnly

  return (
    <div className="max-h-[64vh] overflow-y-auto pr-1 app-scrollbar">
      {error ? (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4">
        {showEditableName ? (
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-[var(--glass-text-secondary)]">{t('fields.name')}</span>
            <input
              value={draft.name}
              onChange={(event) => onNameChange(event.target.value)}
              className="glass-input-base h-10 px-3 text-sm text-[var(--glass-text-primary)]"
            />
          </label>
        ) : null}

        <VisualStyleForm config={visualConfig} readOnly={readOnly} onChange={onVisualConfigChange} />
      </div>
    </div>
  )
}

function VisualStyleForm({
  config,
  readOnly,
  onChange,
}: {
  config: VisualStyleConfig
  readOnly: boolean
  onChange: (patch: Partial<VisualStyleConfig>) => void
}) {
  const t = useTranslations('profile.stylePresets')
  const visibleConfig = normalizePromptOnlyVisualStyleConfig(config)

  return (
    <div className="grid gap-2">
      <ConfigTextarea
        label={t('fields.prompt')}
        value={visibleConfig.prompt}
        readOnly={readOnly}
        onChange={(value) => onChange({ prompt: value })}
        rows={4}
      />
    </div>
  )
}

function ConfigTextarea({
  label,
  value,
  readOnly,
  onChange,
  rows = 3,
}: {
  label: string
  value: string
  readOnly: boolean
  rows?: number
  onChange: (value: string) => void
}) {
  if (readOnly) {
    return (
      <div className="rounded-2xl bg-[var(--glass-bg-base)] px-4 py-3 text-sm shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <span className="mb-2 block font-semibold text-[var(--glass-text-primary)]">{label}</span>
        <p className="min-h-5 whitespace-pre-wrap break-words leading-relaxed text-[var(--glass-text-secondary)]">
          {value || '—'}
        </p>
      </div>
    )
  }

  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-[var(--glass-text-secondary)]">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className="glass-input-base w-full resize-none px-3 py-2 text-sm leading-relaxed text-[var(--glass-text-primary)] app-scrollbar"
      />
    </label>
  )
}
