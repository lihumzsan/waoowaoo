'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { GlassModalShell } from '@/components/ui/primitives'
import { apiFetch } from '@/lib/api-fetch'
import { ART_STYLES, getArtStylePrompt } from '@/lib/constants'
import { buildPromptOnlyVisualStyleConfig, normalizePromptOnlyVisualStyleConfig } from '@/lib/style-preset/visual-config'
import StylePresetEditor from './StylePresetEditor'
import {
  buildDraft,
  readDesignedPreset,
  readPresetList,
  type DraftState,
} from './stylePresetEditorState'
import type {
  PresetSource,
  StylePresetKind,
  StylePresetView,
  VisualStyleConfig,
} from '@/lib/style-preset/types'

type EditorMode = 'create' | 'edit-user' | 'view-system'

export type StylePresetListItem = {
  source: PresetSource
  id: string
  kind: StylePresetKind
  name: string
  summary: string | null
  config: VisualStyleConfig
}

export type StylePresetKindSections = Record<StylePresetKind, StylePresetListItem[]>

export function splitStylePresetKindSections(presets: StylePresetListItem[]): StylePresetKindSections {
  return {
    visual_style: presets,
  }
}

function buildSystemVisualConfig(presetId: string, locale: string): VisualStyleConfig {
  return buildPromptOnlyVisualStyleConfig(getArtStylePrompt(presetId, locale === 'en' ? 'en' : 'zh'))
}

export default function StylePresetsTab() {
  const t = useTranslations('profile.stylePresets')
  const tc = useTranslations('common')
  const locale = useLocale()
  const [presets, setPresets] = useState<StylePresetView[]>([])
  const [draft, setDraft] = useState<DraftState>(() => buildDraft('visual_style'))
  const [editorMode, setEditorMode] = useState<EditorMode>('create')
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [designing, setDesigning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const systemPresets = useMemo<StylePresetListItem[]>(() => (
    ART_STYLES.map((style) => ({
      source: 'system' as const,
      id: style.value,
      kind: 'visual_style' as const,
      name: style.label,
      summary: getArtStylePrompt(style.value, locale === 'en' ? 'en' : 'zh'),
      config: buildSystemVisualConfig(style.value, locale),
    }))
  ), [locale])

  const listItems = useMemo<StylePresetListItem[]>(() => [
    ...systemPresets,
    ...presets.map((preset) => ({
      source: 'user' as const,
      id: preset.id,
      kind: preset.kind,
      name: preset.name,
      summary: preset.summary,
      config: preset.config,
    })),
  ], [presets, systemPresets])

  const canSaveDraft = useMemo(() => {
    if (!draft.name.trim()) return false
    const config = normalizePromptOnlyVisualStyleConfig(draft.config)
    return config.prompt.trim().length > 0
  }, [draft])

  const loadPresets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch('/api/user/style-presets')
      const data = await response.json().catch(() => null) as unknown
      if (!response.ok) throw new Error(t('loadFailed'))
      setPresets(readPresetList(data))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadPresets()
  }, [loadPresets])

  const createPreset = () => {
    setDraft(buildDraft('visual_style'))
    setEditorMode('create')
    setError(null)
    setEditorOpen(true)
  }

  const openPreset = (preset: StylePresetListItem) => {
    setDraft({
      id: preset.source === 'user' ? preset.id : null,
      kind: preset.kind,
      name: preset.name,
      summary: preset.summary ?? '',
      instruction: '',
      config: normalizePromptOnlyVisualStyleConfig(preset.config),
    })
    setEditorMode(preset.source === 'user' ? 'edit-user' : 'view-system')
    setError(null)
    setEditorOpen(true)
  }

  const designPreset = async () => {
    if (!draft.instruction.trim() || designing) return
    setDesigning(true)
    setError(null)
    try {
      const response = await apiFetch('/api/user/style-presets/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'visual_style',
          instruction: draft.instruction,
          locale,
        }),
      })
      const data = await response.json().catch(() => null) as unknown
      if (!response.ok) throw new Error(t('designFailed'))
      const designed = readDesignedPreset(data)
      if (!designed) throw new Error(t('designFailed'))
      setDraft((current) => ({
        ...current,
        kind: designed.kind,
        name: designed.name,
        summary: designed.summary,
        config: normalizePromptOnlyVisualStyleConfig(designed.config),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('designFailed'))
    } finally {
      setDesigning(false)
    }
  }

  const savePreset = async () => {
    if (saving) return
    if (!draft.name.trim()) return
    const config = normalizePromptOnlyVisualStyleConfig(draft.config)
    if (!config.prompt.trim()) return

    setSaving(true)
    setError(null)
    try {
      const payload = {
        kind: 'visual_style' as const,
        name: draft.name,
        summary: draft.summary.trim() ? draft.summary : null,
        config,
      }
      const body = draft.id
        ? {
            name: payload.name,
            summary: payload.summary,
            config: payload.config,
          }
        : payload
      const response = await apiFetch(draft.id ? `/api/user/style-presets/${draft.id}` : '/api/user/style-presets', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(t('saveFailed'))
      await loadPresets()
      setEditorOpen(false)
      setEditorMode('create')
      setDraft(buildDraft('visual_style'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const deletePreset = async (presetId: string) => {
    if (!window.confirm(t('deleteConfirm'))) return
    setError(null)
    const response = await apiFetch(`/api/user/style-presets/${presetId}`, { method: 'DELETE' })
    if (!response.ok) {
      setError(t('deleteFailed'))
      return
    }
    await loadPresets()
    if (draft.id === presetId) {
      setEditorOpen(false)
      setEditorMode('create')
      setDraft(buildDraft('visual_style'))
    }
  }

  const updateVisualConfig = (patch: Partial<VisualStyleConfig>) => {
    setDraft((current) => ({
      ...current,
      config: {
        ...current.config,
        ...patch,
      },
    }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--glass-stroke-base)] px-6 py-5">
        <h2 className="text-xl font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--glass-text-tertiary)]">{t('subtitle')}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 app-scrollbar">
        <div className="mb-7 flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={createPreset}
            className="glass-btn-base glass-btn-primary flex items-center gap-2 px-4 py-2 text-sm font-semibold"
            aria-label={t('newPreset')}
            title={t('newPreset')}
          >
            <AppIcon name="plus" className="h-4 w-4" />
            {t('newPreset')}
          </button>
        </div>

        {error && !editorOpen ? (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        ) : null}
        <PresetList
          loading={loading}
          presets={listItems}
          onOpen={openPreset}
          onCreate={createPreset}
          onDelete={deletePreset}
        />
      </div>

      <GlassModalShell
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editorMode === 'view-system' ? t('systemTitle') : draft.id ? t('editTitle') : t('createTitle')}
        description={editorMode === 'view-system' ? t('systemDescription') : draft.id ? t('editDescription') : t('createDescription')}
        size="asset"
        showDividers={false}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm"
            >
              {tc('cancel')}
            </button>
            {editorMode !== 'view-system' ? (
              <button
                type="button"
                onClick={() => void savePreset()}
                disabled={!canSaveDraft || saving}
                className="glass-btn-base glass-btn-primary px-5 py-2 text-sm disabled:opacity-50"
              >
                {saving ? t('saving') : t('save')}
              </button>
            ) : null}
          </div>
        }
      >
        <StylePresetEditor
          draft={draft}
          error={error}
          readOnly={editorMode === 'view-system'}
          onNameChange={(value) => setDraft((current) => ({ ...current, name: value }))}
          onVisualConfigChange={updateVisualConfig}
        />
        {editorMode !== 'view-system' ? (
          <div className="mt-4 grid gap-2">
            <label className="grid gap-1.5">
              <span className="font-medium text-[var(--glass-text-secondary)]">{t('fields.instruction')}</span>
              <textarea
                value={draft.instruction}
                onChange={(event) => setDraft((current) => ({ ...current, instruction: event.target.value }))}
                rows={4}
                className="glass-input-base resize-none px-3 py-2 text-sm leading-relaxed text-[var(--glass-text-primary)] app-scrollbar"
              />
            </label>
            <button
              type="button"
              onClick={() => void designPreset()}
              disabled={!draft.instruction.trim() || designing}
              className="glass-btn-base glass-btn-primary h-10 w-fit px-4 text-sm disabled:opacity-50"
            >
              <AppIcon name="sparkles" className="h-4 w-4" />
              {designing ? t('designing') : t('design')}
            </button>
          </div>
        ) : null}
      </GlassModalShell>
    </div>
  )
}

function PresetList({
  loading,
  presets,
  onOpen,
  onCreate,
  onDelete,
}: {
  loading: boolean
  presets: StylePresetListItem[]
  onOpen: (preset: StylePresetListItem) => void
  onCreate: () => void
  onDelete: (presetId: string) => Promise<void>
}) {
  const t = useTranslations('profile.stylePresets')
  const sections = splitStylePresetKindSections(presets)
  const visiblePresets = sections.visual_style

  return (
    <div>
      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-[var(--glass-text-tertiary)]">{t('loading')}</div>
      ) : visiblePresets.length === 0 ? (
        <div className="glass-surface glass-card-shadow-soft flex min-h-[240px] flex-col items-center justify-center rounded-2xl p-8 text-center">
          <span className="glass-surface-soft mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl text-[var(--glass-text-secondary)]">
            <AppIcon name="sparkles" className="h-6 w-6" />
          </span>
          <p className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('empty')}</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--glass-text-tertiary)]">{t('emptyDescription')}</p>
          <button
            type="button"
            onClick={onCreate}
            className="glass-btn-base glass-btn-primary mt-4 flex items-center gap-2 px-3 py-2 text-sm"
          >
            <AppIcon name="plus" className="h-4 w-4" />
            {t('newPreset')}
          </button>
        </div>
      ) : (
        <StylePresetSection
          title={t('kind.visual_style')}
          count={visiblePresets.length}
          presets={visiblePresets}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      )}
    </div>
  )
}

function StylePresetSection({
  title,
  count,
  presets,
  onOpen,
  onDelete,
}: {
  title: string
  count: number
  presets: StylePresetListItem[]
  onOpen: (preset: StylePresetListItem) => void
  onDelete: (presetId: string) => Promise<void>
}) {
  const t = useTranslations('profile.stylePresets')

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-base font-semibold text-[var(--glass-text-primary)]">{title}</h3>
        <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-sm font-semibold text-[var(--glass-text-tertiary)]">
          {t('sectionCount', { count })}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        {presets.map((preset) => (
          <StylePresetCard
            key={`${preset.source}-${preset.id}`}
            preset={preset}
            onOpen={onOpen}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  )
}

export function StylePresetCard({
  preset,
  onOpen,
  onDelete,
}: {
  preset: StylePresetListItem
  onOpen: (preset: StylePresetListItem) => void
  onDelete: (presetId: string) => Promise<void>
}) {
  const t = useTranslations('profile.stylePresets')

  return (
    <div className="glass-surface glass-card-shadow-soft group relative flex min-h-[132px] w-full rounded-2xl p-5 transition-all">
      <button
        type="button"
        onClick={() => onOpen(preset)}
        className="flex min-w-0 flex-1 items-start gap-4 pr-20 text-left"
      >
        <span className="glass-surface-soft mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--glass-text-secondary)]">
          <AppIcon name="image" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-[var(--glass-text-primary)]">{preset.name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--glass-text-tertiary)]">
            <span>{t('kind.visual_style')}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--glass-text-tertiary)] opacity-50" />
            <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-xs font-semibold text-[var(--glass-text-secondary)]">
              {preset.source === 'system' ? t('source.system') : t('source.user')}
            </span>
          </div>
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
            {preset.summary ?? t('noSummary')}
          </p>
        </div>
      </button>
      <div className="absolute right-4 top-4 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onOpen(preset)}
          className="glass-btn-base glass-btn-soft inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--glass-text-tertiary)] transition-colors group-hover:text-[var(--glass-text-primary)]"
          aria-label={t('editTitle')}
          title={t('editTitle')}
        >
          <AppIcon name="edit" className="h-4 w-4" />
        </button>
        {preset.source === 'user' ? (
          <button
            type="button"
            onClick={() => void onDelete(preset.id)}
            className="glass-btn-base glass-btn-soft inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--glass-text-tertiary)] transition-colors hover:text-red-400"
            aria-label={t('delete')}
            title={t('delete')}
          >
            <AppIcon name="trash" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
