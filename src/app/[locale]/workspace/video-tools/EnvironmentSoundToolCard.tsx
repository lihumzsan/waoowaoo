'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { EnvironmentSoundPlan, EnvironmentSoundZone } from '@/lib/video-tools/environment-sound'
import {
  canAnalyzeEnvironmentSound,
  canGenerateEnvironmentSound,
  ENVIRONMENT_SOUND_RECOVERY_STORAGE_KEY,
  parseEnvironmentSoundRecovery,
  resolveEnvironmentSoundTaskView,
  type EnvironmentSoundTask,
  type EnvironmentSoundVideo,
} from './environment-sound-state'

type EnvironmentSoundToolCardProps = {
  initialVideo: EnvironmentSoundVideo | null
}

type UploadedVoice = {
  key: string
  url: string
  name: string
}

const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000

function taskPlaceholder(taskId: string): EnvironmentSoundTask {
  return {
    id: taskId,
    status: 'queued',
    progress: 0,
    payload: null,
    result: null,
    error: null,
  }
}

function splitLines(value: string): string[] {
  return value.split(/\n+/).map((line) => line.trim()).filter(Boolean)
}

function phaseDot(active: boolean, failed: boolean): string {
  if (failed) return 'bg-red-500'
  if (active) return 'bg-blue-500 animate-pulse'
  return 'bg-emerald-500'
}

export default function EnvironmentSoundToolCard({ initialVideo }: EnvironmentSoundToolCardProps) {
  const t = useTranslations('videoTools.environmentSound')
  const videoInputRef = useRef<HTMLInputElement>(null)
  const voiceInputRef = useRef<HTMLInputElement>(null)
  const initialVideoRef = useRef(initialVideo)
  initialVideoRef.current = initialVideo
  const adoptedVideoKeyRef = useRef(initialVideo?.key || null)
  const [video, setVideo] = useState<EnvironmentSoundVideo | null>(initialVideo)
  const [videoReplaced, setVideoReplaced] = useState(false)
  const [voice, setVoice] = useState<UploadedVoice | null>(null)
  const [scriptDialogue, setScriptDialogue] = useState('')
  const [plan, setPlan] = useState<EnvironmentSoundPlan | null>(null)
  const [task, setTask] = useState<EnvironmentSoundTask | null>(null)
  const [uploading, setUploading] = useState<'video' | 'voice' | null>(null)
  const [submitting, setSubmitting] = useState<'analyze' | 'generate' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (videoReplaced || !initialVideo || adoptedVideoKeyRef.current === initialVideo.key) return
    const replacingPreviousResult = adoptedVideoKeyRef.current !== null
    adoptedVideoKeyRef.current = initialVideo.key
    setVideo(initialVideo)
    if (replacingPreviousResult) {
      setPlan(null)
      setTask(null)
    }
  }, [initialVideo, videoReplaced])

  const taskView = resolveEnvironmentSoundTaskView(task)

  const fetchTask = useCallback(async (taskId: string) => {
    const search = new URLSearchParams({ taskId })
    const response = await apiFetch(`/api/video-tools/environment-sound?${search}`)
    if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.statusFailed')))
    const nextTask = await response.json() as EnvironmentSoundTask
    setTask((current) => current?.id === taskId ? nextTask : current)
  }, [t])

  useEffect(() => {
    const raw = window.localStorage.getItem(ENVIRONMENT_SOUND_RECOVERY_STORAGE_KEY)
    const recovery = parseEnvironmentSoundRecovery(raw)
    if (!recovery) {
      if (raw) window.localStorage.removeItem(ENVIRONMENT_SOUND_RECOVERY_STORAGE_KEY)
      return
    }
    adoptedVideoKeyRef.current = recovery.video.key
    setVideo(recovery.video)
    setVideoReplaced(true)
    setTask(taskPlaceholder(recovery.taskId))
    void fetchTask(recovery.taskId).catch(() => {
      window.localStorage.removeItem(ENVIRONMENT_SOUND_RECOVERY_STORAGE_KEY)
      setTask((current) => current?.id === recovery.taskId ? null : current)
      const fallbackVideo = initialVideoRef.current
      adoptedVideoKeyRef.current = fallbackVideo?.key || null
      setVideo(fallbackVideo)
      setVideoReplaced(false)
    })
  }, [fetchTask])

  useEffect(() => {
    if (!task || !taskView.active) return
    const timer = window.setInterval(() => {
      void fetchTask(task.id).catch((cause) => {
        setError(cause instanceof Error ? cause.message : t('errors.statusFailed'))
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [fetchTask, t, task, taskView.active])

  useEffect(() => {
    if (taskView.plan) setPlan(taskView.plan)
  }, [taskView.plan])

  useEffect(() => {
    if (!task?.id || !video || !taskView.expiresAt) return
    window.localStorage.setItem(ENVIRONMENT_SOUND_RECOVERY_STORAGE_KEY, JSON.stringify({
      taskId: task.id,
      video,
      expiresAt: taskView.expiresAt,
    }))
  }, [task?.id, taskView.expiresAt, video])

  const clearTaskRecovery = () => {
    window.localStorage.removeItem(ENVIRONMENT_SOUND_RECOVERY_STORAGE_KEY)
  }

  const releaseVoice = async (uploaded: UploadedVoice) => {
    await apiFetch('/api/video-tools/environment-sound/voice-upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: uploaded.key }),
    })
  }

  const uploadVideo = async (file: File) => {
    setUploading('video')
    setError(null)
    try {
      const headers = new Headers({ 'x-file-name': encodeURIComponent(file.name) })
      if (file.type) headers.set('Content-Type', file.type)
      const response = await apiFetch('/api/video-tools/uploads', { method: 'POST', headers, body: file })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.videoUploadFailed')))
      const uploaded = await response.json() as EnvironmentSoundVideo
      setVideo(uploaded)
      setVideoReplaced(true)
      setPlan(null)
      setTask(null)
      clearTaskRecovery()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.videoUploadFailed'))
    } finally {
      setUploading(null)
    }
  }

  const uploadVoice = async (file: File) => {
    setUploading('voice')
    setError(null)
    try {
      const headers = new Headers({ 'x-file-name': encodeURIComponent(file.name) })
      if (file.type) headers.set('Content-Type', file.type)
      const response = await apiFetch('/api/video-tools/environment-sound/voice-upload', {
        method: 'POST',
        headers,
        body: file,
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.voiceUploadFailed')))
      const uploaded = await response.json() as UploadedVoice
      const previous = voice
      setVoice(uploaded)
      if (previous) void releaseVoice(previous).catch(() => undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.voiceUploadFailed'))
    } finally {
      setUploading(null)
    }
  }

  const submit = async (action: 'analyze' | 'generate') => {
    if (!video || submitting) return
    if (action === 'generate' && !plan) return
    setSubmitting(action)
    setError(null)
    try {
      const response = await apiFetch('/api/video-tools/environment-sound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'analyze'
          ? {
              action,
              videoKey: video.key,
              videoName: video.name,
              ...(scriptDialogue.trim() ? { scriptDialogue: scriptDialogue.trim() } : {}),
              ...(voice ? { voiceKey: voice.key } : {}),
            }
          : {
              action,
              videoKey: video.key,
              videoName: video.name,
              plan,
            }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(
        response,
        action === 'analyze' ? t('errors.analyzeFailed') : t('errors.generateFailed'),
      ))
      const result = await response.json() as { taskId: string }
      setTask(taskPlaceholder(result.taskId))
      window.localStorage.setItem(ENVIRONMENT_SOUND_RECOVERY_STORAGE_KEY, JSON.stringify({
        taskId: result.taskId,
        video,
        expiresAt: new Date(Date.now() + RECOVERY_TTL_MS).toISOString(),
      }))
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : action === 'analyze' ? t('errors.analyzeFailed') : t('errors.generateFailed'))
    } finally {
      setSubmitting(null)
    }
  }

  const updateZone = (index: number, update: Partial<EnvironmentSoundZone>) => {
    setPlan((current) => current ? {
      ...current,
      zones: current.zones.map((zone, zoneIndex) => zoneIndex === index ? { ...zone, ...update } : zone),
    } : current)
  }

  const active = taskView.active || !!submitting
  const canAnalyze = canAnalyzeEnvironmentSound(video, task, !!uploading) && !submitting
  const canGenerate = canGenerateEnvironmentSound(video, plan, task) && !submitting && !uploading

  return (
    <section className="glass-surface overflow-hidden rounded-3xl border border-[var(--glass-stroke-base)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--glass-stroke-base)] px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-600">
            <AppIcon name="audioWave" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('description')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-xs text-[var(--glass-text-secondary)]">
          <span className={`h-2 w-2 rounded-full ${phaseDot(active, taskView.phase === 'failed')}`} />
          {t(`status.${taskView.phase}`)}
          {taskView.active ? ` ${taskView.progress}%` : ''}
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('video.title')}</h3>
                <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('video.hint')}</p>
              </div>
              <button type="button" onClick={() => videoInputRef.current?.click()} disabled={active || !!uploading} className="glass-btn-base px-3 py-2 text-xs disabled:opacity-50">
                <AppIcon name={uploading === 'video' ? 'loader' : 'cloudUpload'} className={`h-4 w-4 ${uploading === 'video' ? 'animate-spin' : ''}`} />
                {video ? t('video.replace') : t('video.select')}
              </button>
            </div>
            {video ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-[var(--glass-stroke-base)] bg-black">
                <video key={video.url} src={video.url} controls preload="metadata" className="aspect-video w-full object-contain" />
              </div>
            ) : (
              <button type="button" onClick={() => videoInputRef.current?.click()} disabled={active || !!uploading} className="mt-4 flex min-h-48 w-full flex-col items-center justify-center rounded-xl border border-dashed border-[var(--glass-stroke-strong)] bg-[var(--glass-bg-muted)] text-sm text-[var(--glass-text-secondary)] disabled:opacity-50">
                <AppIcon name="film" className="mb-2 h-7 w-7" />
                {t('video.select')}
              </button>
            )}
            {video ? <p className="mt-2 truncate text-xs text-[var(--glass-text-tertiary)]">{video.name}</p> : null}
            <input ref={videoInputRef} type="file" accept=".mp4,.mov,.webm,.mkv,video/*" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void uploadVideo(file)
              event.target.value = ''
            }} />
          </div>

          <div className="space-y-4 rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
            <label className="block text-sm font-semibold text-[var(--glass-text-primary)]">
              {t('script.title')}
              <textarea value={scriptDialogue} onChange={(event) => setScriptDialogue(event.target.value)} disabled={active} rows={7} maxLength={20000} placeholder={t('script.placeholder')} className="mt-2 block w-full resize-y rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm font-normal text-[var(--glass-text-primary)] placeholder:text-[var(--glass-text-tertiary)] disabled:opacity-60" />
            </label>
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('voice.title')}</p>
                  <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('voice.hint')}</p>
                </div>
                <button type="button" onClick={() => voiceInputRef.current?.click()} disabled={active || !!uploading} className="glass-btn-base px-3 py-2 text-xs disabled:opacity-50">
                  <AppIcon name={uploading === 'voice' ? 'loader' : 'audioWave'} className={`h-4 w-4 ${uploading === 'voice' ? 'animate-spin' : ''}`} />
                  {voice ? t('voice.replace') : t('voice.select')}
                </button>
              </div>
              {voice ? (
                <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2">
                  <span className="truncate text-xs text-[var(--glass-text-secondary)]">{voice.name}</span>
                  <button type="button" onClick={() => {
                    const previous = voice
                    setVoice(null)
                    if (previous) void releaseVoice(previous).catch(() => undefined)
                  }} disabled={active} className="text-xs text-red-600 disabled:opacity-50">{t('voice.remove')}</button>
                </div>
              ) : null}
              <input ref={voiceInputRef} type="file" accept=".mp3,.wav,.m4a,.flac,.ogg,audio/*" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadVoice(file)
                event.target.value = ''
              }} />
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-5 py-5 text-center">
          <p className="mb-3 max-w-3xl text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('analysis.note')}</p>
          <button type="button" onClick={() => void submit('analyze')} disabled={!canAnalyze} className="glass-btn-base glass-btn-primary px-6 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45">
            <AppIcon name={submitting === 'analyze' || taskView.phase === 'analyzing' ? 'loader' : 'sparkles'} className={`h-4 w-4 ${submitting === 'analyze' || taskView.phase === 'analyzing' ? 'animate-spin' : ''}`} />
            {submitting === 'analyze' || taskView.phase === 'analyzing' ? t('analysis.running') : t('analysis.start')}
          </button>
        </div>

        {plan ? (
          <section className="rounded-2xl border border-[var(--glass-stroke-base)]">
            <div className="border-b border-[var(--glass-stroke-base)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('plan.title')}</h3>
              <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('plan.hint', { duration: plan.durationSeconds.toFixed(1), count: plan.zones.length })}</p>
            </div>
            <div className="space-y-4 p-4">
              <label className="block text-xs font-semibold text-[var(--glass-text-secondary)]">
                {t('plan.summary')}
                <textarea value={plan.summaryZh} onChange={(event) => setPlan({ ...plan, summaryZh: event.target.value })} disabled={active} rows={2} className="mt-1 block w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm font-normal text-[var(--glass-text-primary)] disabled:opacity-60" />
              </label>
              {plan.zones.map((zone, index) => (
                <article key={zone.id} className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('plan.zone', { index: index + 1 })}</h4>
                    <span className="rounded-full bg-[var(--glass-bg-surface)] px-3 py-1 text-xs text-[var(--glass-text-secondary)]">{zone.startSeconds.toFixed(1)}s – {zone.endSeconds.toFixed(1)}s</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-xs font-semibold text-[var(--glass-text-secondary)]">{t('plan.scene')}<textarea rows={2} value={zone.sceneZh} onChange={(event) => updateZone(index, { sceneZh: event.target.value })} disabled={active} className="mt-1 block w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm font-normal text-[var(--glass-text-primary)] disabled:opacity-60" /></label>
                    <label className="text-xs font-semibold text-[var(--glass-text-secondary)]">{t('plan.ambience')}<textarea rows={2} value={zone.ambienceZh} onChange={(event) => updateZone(index, { ambienceZh: event.target.value })} disabled={active} className="mt-1 block w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm font-normal text-[var(--glass-text-primary)] disabled:opacity-60" /></label>
                    <label className="text-xs font-semibold text-[var(--glass-text-secondary)]">{t('plan.events')}<textarea rows={3} value={zone.eventSoundsZh.join('\n')} onChange={(event) => updateZone(index, { eventSoundsZh: splitLines(event.target.value) })} disabled={active} className="mt-1 block w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm font-normal text-[var(--glass-text-primary)] disabled:opacity-60" /></label>
                    <label className="text-xs font-semibold text-[var(--glass-text-secondary)]">{t('plan.avoid')}<textarea rows={3} value={zone.avoidSoundsZh.join('\n')} onChange={(event) => updateZone(index, { avoidSoundsZh: splitLines(event.target.value) })} disabled={active} className="mt-1 block w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm font-normal text-[var(--glass-text-primary)] disabled:opacity-60" /></label>
                    <label className="text-xs font-semibold text-[var(--glass-text-secondary)] md:col-span-2">{t('plan.prompt')}<textarea rows={3} value={zone.promptEn} onChange={(event) => updateZone(index, { promptEn: event.target.value })} disabled={active} className="mt-1 block w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm font-normal text-[var(--glass-text-primary)] disabled:opacity-60" /></label>
                    <label className="text-xs font-semibold text-[var(--glass-text-secondary)]">{t('plan.negative')}<textarea rows={2} value={zone.negativePromptEn} onChange={(event) => updateZone(index, { negativePromptEn: event.target.value })} disabled={active} className="mt-1 block w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm font-normal text-[var(--glass-text-primary)] disabled:opacity-60" /></label>
                    <label className="text-xs font-semibold text-[var(--glass-text-secondary)]">{t('plan.transition')}<select value={zone.transitionToNext} onChange={(event) => updateZone(index, { transitionToNext: event.target.value as 'smooth' | 'hard' })} disabled={active || index === plan.zones.length - 1} className="mt-1 block w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm font-normal text-[var(--glass-text-primary)] disabled:opacity-60"><option value="smooth">{t('plan.smooth')}</option><option value="hard">{t('plan.hard')}</option></select></label>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {plan ? (
          <div className="flex flex-col items-center rounded-2xl border border-violet-500/20 bg-violet-500/5 px-5 py-5 text-center">
            <p className="mb-3 max-w-3xl text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('generation.note')}</p>
            <button type="button" onClick={() => void submit('generate')} disabled={!canGenerate} className="glass-btn-base glass-btn-primary px-6 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45">
              <AppIcon name={submitting === 'generate' || taskView.phase === 'generating' || taskView.phase === 'persisting' ? 'loader' : 'audioWave'} className={`h-4 w-4 ${submitting === 'generate' || taskView.phase === 'generating' || taskView.phase === 'persisting' ? 'animate-spin' : ''}`} />
              {submitting === 'generate' || taskView.phase === 'generating' || taskView.phase === 'persisting' ? t('generation.running') : t('generation.start')}
            </button>
          </div>
        ) : null}

        {taskView.audioUrl ? (
          <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('result.title')}</h3>
                <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('result.hint', { duration: (taskView.durationSeconds || plan?.durationSeconds || 0).toFixed(1) })}</p>
                <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('result.ttl')}</p>
              </div>
              <a href={taskView.audioUrl} download className="glass-btn-base px-4 py-2 text-xs font-semibold">
                <AppIcon name="download" className="h-4 w-4" />
                {t('result.download')}
              </a>
            </div>
            <audio key={taskView.audioUrl} src={taskView.audioUrl} controls preload="metadata" className="mt-4 w-full" />
          </section>
        ) : null}

        {error || taskView.errorMessage ? (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600">{error || taskView.errorMessage}</p>
        ) : null}
      </div>
    </section>
  )
}
