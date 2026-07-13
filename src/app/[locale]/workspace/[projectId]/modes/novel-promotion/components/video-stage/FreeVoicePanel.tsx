'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import {
  useCreateFreeVoice,
  useDeleteFreeVoiceRecord,
  useFreeVoices,
  useGenerateFreeVoiceVersion,
  useGlobalVoices,
  useKeepFreeVoiceVersion,
  useProjectCharacters,
} from '@/lib/query/hooks'
import { useTaskTargetStateMap } from '@/lib/query/hooks/useTaskTargetStateMap'
import { TASK_TYPE } from '@/lib/task/types'
import {
  canSubmitFreeVoice,
  safeFreeVoiceFilename,
  selectCharacterDefaultVoice,
  type FreeVoiceDraftVoice,
} from './free-voice-state'

const TARGET_TYPE = 'NovelPromotionFreeVoiceVersion'

export default function FreeVoicePanel({ projectId }: { projectId: string }) {
  const t = useTranslations('voice.freeVoice')
  const [expanded, setExpanded] = useState(true)
  const [text, setText] = useState('')
  const [characterId, setCharacterId] = useState('')
  const [voiceKey, setVoiceKey] = useState('character')
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<string | null>(null)

  const recordsQuery = useFreeVoices(projectId)
  const charactersQuery = useProjectCharacters(projectId)
  const voicesQuery = useGlobalVoices()
  const createMutation = useCreateFreeVoice(projectId)
  const regenerateMutation = useGenerateFreeVoiceVersion(projectId)
  const keepMutation = useKeepFreeVoiceVersion(projectId)
  const deleteMutation = useDeleteFreeVoiceRecord(projectId)

  const records = useMemo(() => recordsQuery.data?.records || [], [recordsQuery.data?.records])
  const characters = charactersQuery.data || []
  const globalVoices = (voicesQuery.data || []).filter((voice) => !!voice.customVoiceUrl)
  const character = characters.find((item) => item.id === characterId) || null
  const voice: FreeVoiceDraftVoice | null = useMemo(() => {
    if (!character) return null
    if (voiceKey === 'character') return selectCharacterDefaultVoice(character)
    const globalId = voiceKey.replace(/^global:/, '')
    const selected = globalVoices.find((item) => item.id === globalId)
    return selected ? {
      sourceType: 'global_voice',
      sourceId: selected.id,
      name: selected.name,
      referenceAudioUrl: selected.customVoiceUrl,
    } : selectCharacterDefaultVoice(character)
  }, [character, globalVoices, voiceKey])

  const targets = useMemo(() => records.flatMap((record) => record.versions.map((version) => ({
    targetType: TARGET_TYPE,
    targetId: version.id,
    types: [TASK_TYPE.FREE_VOICE],
  }))), [records])
  const taskStates = useTaskTargetStateMap(projectId, targets, { enabled: targets.length > 0 })
  const terminalSignature = useMemo(() => taskStates.data
    .filter((state) => state.phase === 'completed' || state.phase === 'failed')
    .map((state) => `${state.targetId}:${state.phase}:${state.updatedAt || ''}`)
    .join('|'), [taskStates.data])
  const lastRefreshSignature = useRef('')
  useEffect(() => {
    if (!terminalSignature || terminalSignature === lastRefreshSignature.current) return
    lastRefreshSignature.current = terminalSignature
    void recordsQuery.refetch()
  }, [recordsQuery, terminalSignature])

  const stateFor = (versionId: string, fallbackStatus?: string | null) => {
    const live = taskStates.getState(TARGET_TYPE, versionId)
    if (live && live.phase !== 'idle') return live.phase
    return fallbackStatus || 'idle'
  }
  const runningCount = records.reduce((count, record) => count + record.versions.filter((version) => {
    const phase = stateFor(version.id, version.task?.status)
    return phase === 'queued' || phase === 'processing'
  }).length, 0)

  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('actionFailed'))
    }
  }

  const handleCreate = () => runAction(async () => {
    if (!voice || !canSubmitFreeVoice({ text, characterId, voice })) return
    await createMutation.mutateAsync({
      text: text.trim(),
      characterId,
      voiceSourceType: voice.sourceType,
      voiceSourceId: voice.sourceId,
    })
    setText('')
  })

  return (
    <section className="glass-surface rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl glass-chip glass-chip-info flex items-center justify-center">
            <AppIcon name="mic" className="w-5 h-5" />
          </span>
          <span>
            <span className="block font-semibold text-[var(--glass-text-primary)]">{t('title')}</span>
            <span className="block text-xs text-[var(--glass-text-secondary)]">
              {t('summary', { records: records.length, running: runningCount })}
            </span>
          </span>
        </span>
        <span className="text-[var(--glass-text-secondary)]">{expanded ? '⌃' : '⌄'}</span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--glass-stroke-base)] p-5 space-y-5">
          <div className="glass-surface-soft rounded-xl border border-[var(--glass-stroke-strong)] p-4 grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">{t('character')}</span>
              <select
                value={characterId}
                onChange={(event) => { setCharacterId(event.target.value); setVoiceKey('character') }}
                className="glass-select-base w-full px-3 py-2.5"
              >
                <option value="">{t('selectCharacter')}</option>
                {characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">{t('voice')}</span>
              <select
                value={voiceKey}
                disabled={!character}
                onChange={(event) => setVoiceKey(event.target.value)}
                className="glass-select-base w-full px-3 py-2.5 disabled:opacity-50"
              >
                <option value="character">{character ? t('characterDefault', { name: character.name }) : t('selectCharacterFirst')}</option>
                {globalVoices.map((item) => <option key={item.id} value={`global:${item.id}`}>{item.name}</option>)}
              </select>
              {character && !voice?.referenceAudioUrl && (
                <span className="text-xs text-[var(--glass-tone-danger-fg)]">{t('referenceRequired')}</span>
              )}
            </label>
            <label className="md:col-span-2 space-y-1.5">
              <span className="text-sm font-medium">{t('text')}</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={4}
                maxLength={5000}
                placeholder={t('textPlaceholder')}
                className="glass-textarea-base w-full px-3 py-2.5 resize-y"
              />
            </label>
            <div className="md:col-span-2 flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--glass-text-tertiary)]">{text.length}/5000</span>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!canSubmitFreeVoice({ text, characterId, voice }) || createMutation.isPending}
                className="glass-btn-base glass-btn-primary px-5 py-2.5 disabled:opacity-50"
              >
                {createMutation.isPending ? t('submitting') : t('generate')}
              </button>
            </div>
          </div>

          {actionError && <p className="text-sm text-[var(--glass-tone-danger-fg)]">{actionError}</p>}
          {recordsQuery.isLoading ? (
            <p className="text-sm text-[var(--glass-text-secondary)]">{t('loading')}</p>
          ) : records.length === 0 ? (
            <div className="text-center py-10 text-[var(--glass-text-secondary)]">{t('empty')}</div>
          ) : (
            <div className="space-y-4">
              {records.map((record) => {
                const hasActiveTask = record.versions.some((version) => {
                  const phase = stateFor(version.id, version.task?.status)
                  return phase === 'queued' || phase === 'processing'
                })
                const selectedVersionId = selectedVersions[record.id] || ''
                return (
                  <article key={record.id} className="glass-surface-soft rounded-xl p-4 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <details>
                          <summary className="font-medium text-[var(--glass-text-primary)] cursor-pointer line-clamp-2">{record.text}</summary>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--glass-text-secondary)]">{record.text}</p>
                        </details>
                        <p className="mt-2 text-xs text-[var(--glass-text-tertiary)]">
                          {record.characterName} · {record.voiceName} · {new Date(record.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={hasActiveTask || regenerateMutation.isPending}
                          onClick={() => void runAction(() => regenerateMutation.mutateAsync({ recordId: record.id }))}
                          className="glass-btn-base glass-btn-secondary px-3 py-2 text-sm disabled:opacity-50"
                        >{t('newVersion')}</button>
                        <button
                          type="button"
                          disabled={hasActiveTask || deleteMutation.isPending}
                          onClick={() => {
                            if (!window.confirm(t('confirmDelete'))) return
                            void runAction(() => deleteMutation.mutateAsync({ recordId: record.id }))
                          }}
                          className="glass-btn-base glass-btn-secondary px-3 py-2 text-sm text-[var(--glass-tone-danger-fg)] disabled:opacity-50"
                        >{t('deleteRecord')}</button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {record.versions.map((version) => {
                        const liveState = taskStates.getState(TARGET_TYPE, version.id)
                        const phase = stateFor(version.id, version.task?.status)
                        const errorMessage = liveState?.lastError?.message || version.task?.errorMessage
                        return (
                          <label key={version.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--glass-stroke-base)] p-3">
                            <input
                              type="radio"
                              name={`free-voice-${record.id}`}
                              value={version.id}
                              checked={selectedVersionId === version.id}
                              disabled={!version.audioUrl}
                              onChange={() => setSelectedVersions((current) => ({ ...current, [record.id]: version.id }))}
                            />
                            <span className="font-medium">V{version.versionNumber}</span>
                            <span className="text-xs text-[var(--glass-text-secondary)]">{version.audioModel}</span>
                            <span className="text-xs text-[var(--glass-text-secondary)]">
                              {version.audioDuration ? `${(version.audioDuration / 1000).toFixed(1)}s` : phase}
                            </span>
                            {version.audioUrl && <audio controls preload="none" src={version.audioUrl} className="h-8 max-w-64" />}
                            {version.audioUrl && (
                              <a
                                href={version.audioUrl}
                                download={safeFreeVoiceFilename(record, version)}
                                className="glass-btn-base glass-btn-secondary px-3 py-1.5 text-xs"
                              >{t('download')}</a>
                            )}
                            {errorMessage && <span className="basis-full text-xs text-[var(--glass-tone-danger-fg)]">{errorMessage}</span>}
                          </label>
                        )
                      })}
                    </div>

                    {selectedVersionId && record.versions.length > 1 && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={hasActiveTask || keepMutation.isPending}
                          onClick={() => {
                            if (!window.confirm(t('confirmKeep'))) return
                            void runAction(async () => {
                              await keepMutation.mutateAsync({ recordId: record.id, versionId: selectedVersionId })
                              setSelectedVersions((current) => ({ ...current, [record.id]: '' }))
                            })
                          }}
                          className="glass-btn-base glass-btn-primary px-4 py-2 text-sm disabled:opacity-50"
                        >{t('keepOnly')}</button>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
