'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { useProjectCharacters } from '@/lib/query/hooks'
import {
  buildFreeVoiceSubmitInput,
  buildProjectCharacterOptions,
  resolveCharacterPickerState,
} from './free-voice-tool-state'

type FreeVoiceStatus = 'queued' | 'processing' | 'completed' | 'failed'

type FreeVoiceRecord = {
  id: string
  taskId: string
  text: string
  voiceName: string
  projectName?: string | null
  characterName?: string | null
  status: FreeVoiceStatus
  progress: number
  audioUrl?: string | null
  audioDuration?: number | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
}

type ProjectOption = {
  id: string
  name: string
}

function isActive(record: FreeVoiceRecord) {
  return record.status === 'queued' || record.status === 'processing'
}

function formatDuration(value?: number | null) {
  if (!value) return ''
  return `${(value / 1000).toFixed(1)}s`
}

export default function FreeVoiceToolCard() {
  const t = useTranslations('videoTools.freeVoice')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [projectId, setProjectId] = useState('')
  const [characterId, setCharacterId] = useState('')
  const [text, setText] = useState('')
  const [records, setRecords] = useState<FreeVoiceRecord[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const charactersQuery = useProjectCharacters(projectId || null)
  const characters = useMemo(() => charactersQuery.data || [], [charactersQuery.data])
  const characterPickerState = resolveCharacterPickerState({
    projectId,
    isLoading: charactersQuery.isLoading,
    isError: charactersQuery.isError,
    characterCount: characters.length,
  })
  const characterOptions = useMemo(
    () => buildProjectCharacterOptions(characters, t('missingReference')),
    [characters, t],
  )
  const selectedCharacter = useMemo(
    () => characters.find((character) => character.id === characterId),
    [characterId, characters],
  )
  const characterLoadError = characterPickerState === 'error'
    ? t('errors.loadCharactersFailed')
    : null

  useEffect(() => {
    let cancelled = false

    const loadProjects = async () => {
      try {
        const response = await apiFetch('/api/projects?page=1&pageSize=1000')
        if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.loadProjectsFailed')))
        const data = await response.json() as { projects?: ProjectOption[] }
        if (!cancelled) setProjects(data.projects || [])
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t('errors.loadProjectsFailed'))
        }
      } finally {
        if (!cancelled) setLoadingProjects(false)
      }
    }

    void loadProjects()
    return () => {
      cancelled = true
    }
  }, [t])

  const loadRecords = useCallback(async () => {
    const response = await apiFetch('/api/video-tools/free-voice')
    if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.loadFailed')))
    const data = await response.json() as { records: FreeVoiceRecord[] }
    setRecords(data.records || [])
  }, [t])

  useEffect(() => {
    void loadRecords().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : t('errors.loadFailed'))
    })
  }, [loadRecords, t])

  useEffect(() => {
    if (!records.some(isActive)) return
    const timer = window.setInterval(() => {
      void loadRecords().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : t('errors.loadFailed'))
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [loadRecords, records, t])

  const submit = async () => {
    const input = buildFreeVoiceSubmitInput({
      text,
      projectId,
      characterId,
      characterHasReference: !!selectedCharacter?.customVoiceUrl,
    })
    if (!input || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await apiFetch('/api/video-tools/free-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.submitFailed')))
      const data = await response.json() as { record: FreeVoiceRecord }
      setRecords((current) => [data.record, ...current.filter((record) => record.id !== data.record.id)])
      setText('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('errors.submitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = !!buildFreeVoiceSubmitInput({
    text,
    projectId,
    characterId,
    characterHasReference: !!selectedCharacter?.customVoiceUrl,
  }) && !submitting

  return (
    <section data-free-voice-tool className="glass-surface overflow-hidden rounded-3xl border border-[var(--glass-stroke-base)]">
      <div className="border-b border-[var(--glass-stroke-base)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
              <AppIcon name="mic" className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('description')}</p>
            </div>
          </div>
          <span className="rounded-full border border-[var(--glass-stroke-base)] px-3 py-1.5 text-xs text-[var(--glass-text-tertiary)]">
            {t('ttl')}
          </span>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-[var(--glass-text-primary)]">{t('project')}</span>
              <select
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value)
                  setCharacterId('')
                  setError(null)
                }}
                className="glass-select-base w-full px-3 py-2.5"
                disabled={loadingProjects || projects.length === 0 || submitting}
              >
                {loadingProjects || projects.length === 0 ? (
                  <option value="">{loadingProjects ? t('loadingProjects') : t('emptyProjects')}</option>
                ) : (
                  <>
                    <option value="">{t('selectProject')}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </>
                )}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-[var(--glass-text-primary)]">{t('character')}</span>
              <select
                value={characterId}
                onChange={(event) => setCharacterId(event.target.value)}
                className="glass-select-base w-full px-3 py-2.5"
                disabled={characterPickerState !== 'ready' || submitting}
              >
                {characterPickerState === 'select-project' ? (
                  <option value="">{t('selectProjectFirst')}</option>
                ) : characterPickerState === 'loading' ? (
                  <option value="">{t('loadingCharacters')}</option>
                ) : characterPickerState === 'error' ? (
                  <option value="">{t('errors.loadCharactersFailed')}</option>
                ) : characterPickerState === 'empty' ? (
                  <option value="">{t('emptyCharacters')}</option>
                ) : (
                  <>
                    <option value="">{t('selectCharacter')}</option>
                    {characterOptions.map((character) => (
                      <option key={character.id} value={character.id} disabled={character.disabled}>{character.label}</option>
                    ))}
                  </>
                )}
              </select>
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-[var(--glass-text-primary)]">{t('text')}</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={5}
              maxLength={5000}
              placeholder={t('textPlaceholder')}
              className="glass-textarea-base w-full resize-y px-3 py-2.5"
              disabled={submitting}
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-[var(--glass-text-tertiary)]">{text.length}/5000</span>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="glass-btn-base glass-btn-primary px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
            >
              <AppIcon name={submitting ? 'loader' : 'mic'} className={`h-4 w-4 ${submitting ? 'animate-spin' : ''}`} />
              {submitting ? t('submitting') : t('generate')}
            </button>
          </div>

          {characterLoadError || error ? (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-600">{characterLoadError || error}</p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]">
          <div className="border-b border-[var(--glass-stroke-base)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('resultTitle')}</h3>
          </div>
          {records.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center px-5 py-8 text-center text-sm text-[var(--glass-text-tertiary)]">
              <AppIcon name="audioWave" className="mb-3 h-8 w-8" />
              {t('emptyResults')}
            </div>
          ) : (
            <div className="max-h-[34rem] space-y-3 overflow-y-auto p-4">
              {records.map((record) => (
                <article key={record.id} className="rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-[var(--glass-text-secondary)]">
                      {record.projectName && record.characterName
                        ? `${record.projectName} · ${record.characterName}`
                        : record.voiceName}
                    </span>
                    <span className="text-xs text-[var(--glass-text-tertiary)]">{t(`status.${record.status}`)}</span>
                  </div>
                  <p className="line-clamp-2 text-sm font-medium leading-5 text-[var(--glass-text-primary)]">{record.text}</p>
                  {isActive(record) ? (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--glass-stroke-base)]">
                      <span
                        className="block h-full rounded-full bg-[var(--glass-tone-info-fg)]"
                        style={{ width: `${Math.max(8, Math.min(100, record.progress || 8))}%` }}
                      />
                    </div>
                  ) : null}
                  {record.audioUrl ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <audio controls preload="none" src={record.audioUrl} className="h-9 min-w-0 flex-1" />
                      <a href={record.audioUrl} download className="glass-btn-base glass-btn-secondary px-3 py-2 text-xs">
                        <AppIcon name="download" className="h-3.5 w-3.5" />
                        {t('download')}
                      </a>
                    </div>
                  ) : null}
                  {record.audioDuration ? (
                    <p className="mt-2 text-xs text-[var(--glass-text-tertiary)]">{formatDuration(record.audioDuration)}</p>
                  ) : null}
                  {record.errorMessage ? (
                    <p className="mt-2 text-xs text-[var(--glass-tone-danger-fg)]">{record.errorMessage}</p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
