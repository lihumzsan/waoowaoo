'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { useRouter } from '@/i18n/navigation'
import {
  DEFAULT_VIDEO_SEAM_BRIDGE_DURATION,
  DEFAULT_VIDEO_SEAM_BRIDGE_MOTION_PROMPT,
  VIDEO_SEAM_BRIDGE_DURATIONS,
  resolveVideoSeamBridgeMotionPrompt,
  type VideoSeamBridgeDurationSeconds,
} from '@/lib/video-tools/seam-bridge'
import FreeVoiceToolCard from './FreeVoiceToolCard'
import EnvironmentSoundToolCard from './EnvironmentSoundToolCard'
import VideoSeamDiagnostics from './VideoSeamDiagnostics'
import VideoUploadCard from './VideoUploadCard'
import {
  createRecoveredVideoSeamTask,
  readVideoSeamDraft,
  writeVideoSeamDraft,
} from './video-seam-draft'
import {
  createVideoSeamRequestCoordinator,
  requestVideoSeamTaskStatus,
  type VideoSeamRequestCoordinator,
} from './video-seam-request-coordinator'
import {
  canSubmitVideoSeamConcat,
  resolvePersistedVideoSeamTaskId,
  resolveVideoSeamDiagnostics,
  resolveVideoSeamErrorTranslationKey,
  resolveVideoToolTaskView,
  type UploadedVideo,
  type VideoToolTask,
} from './video-tools-state'

type UploadSlot = 'input1' | 'input2'

function statusDotClass(active: boolean, failed: boolean) {
  if (failed) return 'bg-red-500'
  if (active) return 'bg-blue-500 animate-pulse'
  return 'bg-emerald-500'
}

export default function VideoToolsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const t = useTranslations('videoTools')
  const statusFailedMessage = t('errors.statusFailed')
  const [input1, setInput1] = useState<UploadedVideo | null>(null)
  const [input2, setInput2] = useState<UploadedVideo | null>(null)
  const [input1TrimEndFrames, setInput1TrimEndFrames] = useState<number | ''>(0)
  const [input2TrimStartFrames, setInput2TrimStartFrames] = useState<number | ''>(1)
  const [seamMode, setSeamMode] = useState<'direct' | 'ai_bridge'>('direct')
  const [bridgeDurationSeconds, setBridgeDurationSeconds] = useState<VideoSeamBridgeDurationSeconds>(DEFAULT_VIDEO_SEAM_BRIDGE_DURATION)
  const [bridgePrompt, setBridgePrompt] = useState(DEFAULT_VIDEO_SEAM_BRIDGE_MOTION_PROMPT)
  const [uploadingSlot, setUploadingSlot] = useState<UploadSlot | null>(null)
  const [uploadErrors, setUploadErrors] = useState<Partial<Record<UploadSlot, string>>>({})
  const [currentTask, setCurrentTask] = useState<VideoToolTask | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [hydratedUserId, setHydratedUserId] = useState<string | null>(null)
  const authenticatedUserId = status === 'authenticated'
    ? (session?.user as { id?: string } | undefined)?.id?.trim() || null
    : null
  const authenticatedUserIdRef = useRef<string | null>(authenticatedUserId)
  authenticatedUserIdRef.current = authenticatedUserId
  const requestCoordinatorRef = useRef<VideoSeamRequestCoordinator | null>(null)
  if (!requestCoordinatorRef.current) {
    requestCoordinatorRef.current = createVideoSeamRequestCoordinator({
      getCurrentUserId: () => authenticatedUserIdRef.current,
    })
  }
  const videoSeamRequestCoordinator = requestCoordinatorRef.current

  useEffect(() => {
    if (status === 'loading') return
    if (!session) router.push({ pathname: '/auth/signin' })
  }, [router, session, status])

  const fetchCurrentTask = useCallback((userId: string, taskId: string): Promise<void> => {
    return videoSeamRequestCoordinator.run({
      kind: 'task_status',
      userId,
      requestKey: taskId,
      reuseInFlight: true,
      execute: (requestSignal) => requestVideoSeamTaskStatus({
        taskId,
        signal: requestSignal,
        statusFailedMessage,
      }),
      onSuccess: (outcome) => {
        if (outcome.kind === 'missing') {
          setCurrentTask((previous) => previous?.id === taskId ? null : previous)
          setPageError(null)
          return
        }
        setCurrentTask((previous) => previous?.id === taskId ? outcome.task : previous)
        setPageError(null)
      },
      onError: (error) => {
        setPageError(error instanceof Error ? error.message : statusFailedMessage)
      },
    })
  }, [statusFailedMessage, videoSeamRequestCoordinator])

  useEffect(() => {
    videoSeamRequestCoordinator.abortAll()
    setUploadingSlot(null)
    setUploadErrors({})
    setSubmitting(false)
    if (!authenticatedUserId) {
      setHydratedUserId(null)
      return
    }

    setHydratedUserId(null)
    const savedDraft = readVideoSeamDraft(authenticatedUserId)
    setInput1(savedDraft?.input1 || null)
    setInput2(savedDraft?.input2 || null)
    setInput1TrimEndFrames(savedDraft?.input1TrimEndFrames ?? 0)
    setInput2TrimStartFrames(savedDraft?.input2TrimStartFrames ?? 1)
    setSeamMode(savedDraft?.seamMode || 'direct')
    setBridgeDurationSeconds(savedDraft?.bridgeDurationSeconds || 4)
    setBridgePrompt(savedDraft?.bridgePrompt || '')
    setCurrentTask(savedDraft?.taskId ? createRecoveredVideoSeamTask(savedDraft.taskId) : null)
    setPageError(null)
    setHydratedUserId(authenticatedUserId)

    if (savedDraft?.taskId) {
      void fetchCurrentTask(authenticatedUserId, savedDraft.taskId)
    }
    return () => videoSeamRequestCoordinator.abortAll()
  }, [authenticatedUserId, fetchCurrentTask, videoSeamRequestCoordinator])

  const taskView = resolveVideoToolTaskView(currentTask)
  const persistedTaskId = resolvePersistedVideoSeamTaskId(currentTask)
  const diagnostics = resolveVideoSeamDiagnostics(currentTask?.result || null)

  useEffect(() => {
    if (!authenticatedUserId || hydratedUserId !== authenticatedUserId) return
    writeVideoSeamDraft(authenticatedUserId, {
      input1,
      input2,
      input1TrimEndFrames,
      input2TrimStartFrames,
      seamMode,
      bridgeDurationSeconds,
      bridgePrompt,
      taskId: persistedTaskId,
    })
  }, [
    authenticatedUserId,
    bridgeDurationSeconds,
    bridgePrompt,
    hydratedUserId,
    input1,
    input1TrimEndFrames,
    input2,
    input2TrimStartFrames,
    persistedTaskId,
    seamMode,
  ])

  useEffect(() => {
    if (!session || hydratedUserId !== authenticatedUserId || !currentTask || !taskView.active) return
    const timer = window.setInterval(() => {
      if (authenticatedUserId) void fetchCurrentTask(authenticatedUserId, currentTask.id)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [authenticatedUserId, currentTask, fetchCurrentTask, hydratedUserId, session, taskView.active])

  const upload = (slot: UploadSlot, file: File) => {
    const operationUserId = authenticatedUserId
    if (!operationUserId || hydratedUserId !== operationUserId) return
    setUploadingSlot(slot)
    setUploadErrors((previous) => ({ ...previous, [slot]: undefined }))
    setPageError(null)
    void videoSeamRequestCoordinator.run({
      kind: 'upload',
      userId: operationUserId,
      requestKey: slot,
      execute: async (requestSignal) => {
        const headers = new Headers({ 'x-file-name': encodeURIComponent(file.name) })
        if (file.type) headers.set('Content-Type', file.type)
        const response = await apiFetch('/api/video-tools/uploads', {
          method: 'POST',
          headers,
          body: file,
          signal: requestSignal,
        })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.uploadFailed')))
        const uploaded = await response.json() as UploadedVideo & { success: boolean }
        return {
          key: uploaded.key,
          url: uploaded.url,
          name: uploaded.name,
          size: uploaded.size,
          mimeType: uploaded.mimeType,
        }
      },
      onSuccess: (value) => {
        if (slot === 'input1') setInput1(value)
        else setInput2(value)
      },
      onError: (error) => {
        setUploadErrors((previous) => ({
          ...previous,
          [slot]: error instanceof Error ? error.message : t('errors.uploadFailed'),
        }))
      },
      onSettled: () => setUploadingSlot((current) => current === slot ? null : current),
    })
  }

  const submit = () => {
    const operationUserId = authenticatedUserId
    if (
      !operationUserId
      || !input1
      || !input2
      || !canSubmitVideoSeamConcat(
        input1,
        input2,
        currentTask,
        input1TrimEndFrames,
        input2TrimStartFrames,
      )
      || submitting
      || hydratedUserId !== authenticatedUserId
    ) return
    setSubmitting(true)
    setPageError(null)
    void videoSeamRequestCoordinator.run({
      kind: 'submit',
      userId: operationUserId,
      execute: async (requestSignal) => {
        const response = await apiFetch('/api/video-tools/seam-concat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input1: {
              key: input1.key,
              name: input1.name,
              trimEndFrames: input1TrimEndFrames,
            },
            input2: {
              key: input2.key,
              name: input2.name,
              trimStartFrames: input2TrimStartFrames,
            },
            mode: seamMode,
            ...(seamMode === 'ai_bridge' ? {
              bridge: {
                durationSeconds: bridgeDurationSeconds,
                prompt: resolveVideoSeamBridgeMotionPrompt(bridgePrompt),
              },
            } : {}),
          }),
          signal: requestSignal,
        })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.submitFailed')))
        return await response.json() as { taskId: string }
      },
      onSuccess: (data) => {
        videoSeamRequestCoordinator.abort('task_status')
        setCurrentTask(createRecoveredVideoSeamTask(data.taskId))
      },
      onError: (error) => {
        setPageError(error instanceof Error ? error.message : t('errors.submitFailed'))
      },
      onSettled: () => setSubmitting(false),
    })
  }

  if (status === 'loading' || !session) {
    return (
      <div className="glass-page flex min-h-screen items-center justify-center">
        <AppIcon name="loader" className="h-6 w-6 animate-spin text-[var(--glass-tone-info-fg)]" />
      </div>
    )
  }

  const canSubmit = canSubmitVideoSeamConcat(
    input1,
    input2,
    currentTask,
    input1TrimEndFrames,
    input2TrimStartFrames,
  ) && !submitting && !uploadingSlot
    && hydratedUserId === authenticatedUserId
  const phaseLabel = t(`status.${taskView.phase}`)
  const stitchedEnvironmentVideo = taskView.videoKey && taskView.videoUrl
    ? { key: taskView.videoKey, url: taskView.videoUrl, name: t('environmentSound.video.stitchedResult') }
    : null

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-7">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--glass-tone-info-fg)]">
              <AppIcon name="film" className="h-4 w-4" />
              {t('eyebrow')}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--glass-text-primary)]">{t('title')}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--glass-text-secondary)]">{t('subtitle')}</p>
          </div>
        </header>

        <div className="space-y-7">
          <FreeVoiceToolCard />

          <section className="glass-surface overflow-hidden rounded-3xl border border-[var(--glass-stroke-base)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--glass-stroke-base)] px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
                  <AppIcon name="film" className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('seamConcat.title')}</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('seamConcat.description')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-xs text-[var(--glass-text-secondary)]">
                <span className={`h-2 w-2 rounded-full ${statusDotClass(taskView.active, taskView.phase === 'failed')}`} />
                {phaseLabel}
              </div>
            </div>

            <div className="p-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <VideoUploadCard
                  label={t('input1.title')}
                  description={t('input1.description')}
                  value={input1}
                  uploading={uploadingSlot === 'input1'}
                  disabled={taskView.active}
                  error={uploadErrors.input1 || null}
                  onUpload={(file) => void upload('input1', file)}
                  onRemove={() => setInput1(null)}
                  selectLabel={t('actions.select')}
                  replaceLabel={t('actions.replace')}
                  removeLabel={t('actions.remove')}
                  uploadingLabel={t('status.uploading')}
                  trimLabel={t('input1.trimLabel')}
                  trimHelp={t('input1.trimHelp')}
                  trimFrames={input1TrimEndFrames}
                  onTrimFramesChange={setInput1TrimEndFrames}
                />
                <VideoUploadCard
                  label={t('input2.title')}
                  description={t('input2.description')}
                  value={input2}
                  uploading={uploadingSlot === 'input2'}
                  disabled={taskView.active}
                  error={uploadErrors.input2 || null}
                  onUpload={(file) => void upload('input2', file)}
                  onRemove={() => setInput2(null)}
                  selectLabel={t('actions.select')}
                  replaceLabel={t('actions.replace')}
                  removeLabel={t('actions.remove')}
                  uploadingLabel={t('status.uploading')}
                  trimLabel={t('input2.trimLabel')}
                  trimHelp={t('input2.trimHelp')}
                  trimFrames={input2TrimStartFrames}
                  onTrimFramesChange={setInput2TrimStartFrames}
                />
              </div>

              <fieldset className="mt-5 rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
                <legend className="px-1 text-sm font-semibold text-[var(--glass-text-primary)]">{t('bridge.label')}</legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label className={`cursor-pointer rounded-xl border px-4 py-3 text-sm ${seamMode === 'direct' ? 'border-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)]' : 'border-[var(--glass-stroke-base)]'}`}>
                    <input className="sr-only" type="radio" name="seamMode" checked={seamMode === 'direct'} onChange={() => setSeamMode('direct')} />
                    <span className="font-semibold text-[var(--glass-text-primary)]">{t('bridge.direct')}</span>
                  </label>
                  <label className={`cursor-pointer rounded-xl border px-4 py-3 text-sm ${seamMode === 'ai_bridge' ? 'border-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)]' : 'border-[var(--glass-stroke-base)]'}`}>
                    <input className="sr-only" type="radio" name="seamMode" checked={seamMode === 'ai_bridge'} onChange={() => setSeamMode('ai_bridge')} />
                    <span className="font-semibold text-[var(--glass-text-primary)]">{t('bridge.ai')}</span>
                  </label>
                </div>
                {seamMode === 'ai_bridge' ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs leading-5 text-[var(--glass-text-secondary)]">{t('bridge.description')}</p>
                    <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                      {t('bridge.duration')}
                      <select
                        value={bridgeDurationSeconds}
                        onChange={(event) => setBridgeDurationSeconds(Number(event.target.value) as VideoSeamBridgeDurationSeconds)}
                        className="mt-1 block rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)]"
                      >
                        {VIDEO_SEAM_BRIDGE_DURATIONS.map((durationSeconds) => (
                          <option key={durationSeconds} value={durationSeconds}>{durationSeconds} s</option>
                        ))}
                      </select>
                      <span className="mt-1 block font-normal leading-5 text-[var(--glass-text-tertiary)]">
                        {t('bridge.durationHelp')}
                      </span>
                    </label>
                    <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                      {t('bridge.prompt')}
                      <textarea
                        value={bridgePrompt}
                        onChange={(event) => setBridgePrompt(event.target.value)}
                        placeholder={t('bridge.promptPlaceholder')}
                        rows={2}
                        className="mt-1 block w-full resize-y rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)] placeholder:text-[var(--glass-text-tertiary)]"
                      />
                    </label>
                  </div>
                ) : null}
              </fieldset>

              <div className="my-6 flex flex-col items-center rounded-3xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-5 py-5 text-center">
                <p className="mb-4 text-xs leading-5 text-[var(--glass-text-tertiary)]">
                  {seamMode === 'ai_bridge' ? t('workflowNoteAi') : t('workflowNoteDirect')}
                </p>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canSubmit}
                  className="glass-btn-base glass-btn-primary min-w-48 px-6 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <AppIcon name={submitting || taskView.active ? 'loader' : 'film'} className={`h-4 w-4 ${submitting || taskView.active ? 'animate-spin' : ''}`} />
                  {taskView.active ? phaseLabel : t('actions.start')}
                </button>
                {pageError ? (
                  <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-600">{pageError}</p>
                ) : null}
              </div>

              <section className="overflow-hidden rounded-3xl border border-[var(--glass-stroke-base)]">
                <div className="flex items-center justify-between border-b border-[var(--glass-stroke-base)] px-5 py-4">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('result.title')}</h3>
                    <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('result.description')}</p>
                  </div>
                </div>

                {taskView.videoUrl ? (
                  <div className="p-5">
                    <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-black">
                      <video key={taskView.videoUrl} src={taskView.videoUrl} controls preload="metadata" className="aspect-video w-full object-contain" />
                    </div>
                    {diagnostics ? <VideoSeamDiagnostics diagnostics={diagnostics} /> : null}
                  </div>
                ) : (
                  <div className="flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center">
                    <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]">
                      <AppIcon name={taskView.active ? 'loader' : taskView.phase === 'failed' ? 'alert' : 'clapperboard'} className={`h-8 w-8 ${taskView.active ? 'animate-spin' : ''}`} />
                    </span>
                    <p className="text-sm font-semibold text-[var(--glass-text-primary)]">{phaseLabel}</p>
                    <p className="mt-2 max-w-md text-xs leading-5 text-[var(--glass-text-tertiary)]">
                      {taskView.phase === 'failed'
                        ? t(resolveVideoSeamErrorTranslationKey(taskView.errorMessage))
                        : taskView.active ? t('result.processingHint') : t('result.emptyHint')}
                    </p>
                  </div>
                )}
              </section>
            </div>
          </section>

          <EnvironmentSoundToolCard initialVideo={stitchedEnvironmentVideo} />
        </div>
      </main>
    </div>
  )
}
