'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { useRouter } from '@/i18n/navigation'
import VideoUploadCard from './VideoUploadCard'
import {
  canSubmitVideoSeamConcat,
  resolveVideoToolTaskTrimFrames,
  resolveVideoToolTaskView,
  selectCurrentVideoToolTask,
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
  const [input1, setInput1] = useState<UploadedVideo | null>(null)
  const [input2, setInput2] = useState<UploadedVideo | null>(null)
  const [input1TrimEndFrames, setInput1TrimEndFrames] = useState<number | ''>(0)
  const [input2TrimStartFrames, setInput2TrimStartFrames] = useState<number | ''>(1)
  const [uploadingSlot, setUploadingSlot] = useState<UploadSlot | null>(null)
  const [uploadErrors, setUploadErrors] = useState<Partial<Record<UploadSlot, string>>>({})
  const [tasks, setTasks] = useState<VideoToolTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'loading') return
    if (!session) router.push({ pathname: '/auth/signin' })
  }, [router, session, status])

  const fetchTasks = useCallback(async () => {
    const search = new URLSearchParams({ projectId: 'video-tools', limit: '5' })
    search.append('type', 'video_seam_concat')
    const response = await apiFetch(`/api/tasks?${search}`)
    if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.loadTasks')))
    const data = await response.json() as { tasks?: VideoToolTask[] }
    setTasks(data.tasks || [])
  }, [t])

  useEffect(() => {
    if (!session) return
    void fetchTasks().catch((error) => {
      setPageError(error instanceof Error ? error.message : t('errors.loadTasks'))
    })
  }, [fetchTasks, session, t])

  const activeTask = useMemo(
    () => tasks.find((task) => task.status === 'queued' || task.status === 'processing') || null,
    [tasks],
  )
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || null,
    [selectedTaskId, tasks],
  )
  const currentTask = activeTask || selectedTask || selectCurrentVideoToolTask(tasks)
  const taskView = resolveVideoToolTaskView(currentTask)

  useEffect(() => {
    if (!session || !taskView.active) return
    const timer = window.setInterval(() => {
      void fetchTasks().catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [fetchTasks, session, taskView.active])

  const upload = async (slot: UploadSlot, file: File) => {
    setUploadingSlot(slot)
    setUploadErrors((previous) => ({ ...previous, [slot]: undefined }))
    setPageError(null)
    try {
      const formData = new FormData()
      formData.set('file', file)
      const response = await apiFetch('/api/video-tools/uploads', { method: 'POST', body: formData })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.uploadFailed')))
      const uploaded = await response.json() as UploadedVideo & { success: boolean }
      const value: UploadedVideo = {
        key: uploaded.key,
        url: uploaded.url,
        name: uploaded.name,
        size: uploaded.size,
        mimeType: uploaded.mimeType,
      }
      if (slot === 'input1') setInput1(value)
      else setInput2(value)
    } catch (error) {
      setUploadErrors((previous) => ({
        ...previous,
        [slot]: error instanceof Error ? error.message : t('errors.uploadFailed'),
      }))
    } finally {
      setUploadingSlot(null)
    }
  }

  const submit = async () => {
    if (
      !input1
      || !input2
      || !canSubmitVideoSeamConcat(
        input1,
        input2,
        currentTask,
        input1TrimEndFrames,
        input2TrimStartFrames,
      )
      || submitting
    ) return
    setSubmitting(true)
    setPageError(null)
    try {
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
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, t('errors.submitFailed')))
      const data = await response.json() as { taskId: string }
      const now = new Date().toISOString()
      setSelectedTaskId(data.taskId)
      setTasks((previous) => [{
        id: data.taskId,
        status: 'queued',
        progress: 0,
        createdAt: now,
        updatedAt: now,
        payload: {
          input1Name: input1.name,
          input1TrimEndFrames,
          input2Name: input2.name,
          input2TrimStartFrames,
        },
        result: null,
        error: null,
      }, ...previous.filter((task) => task.id !== data.taskId)].slice(0, 5))
      await fetchTasks()
    } catch (error) {
      setPageError(error instanceof Error ? error.message : t('errors.submitFailed'))
    } finally {
      setSubmitting(false)
    }
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
  const phaseLabel = t(`status.${taskView.phase}`)

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--glass-tone-info-fg)]">
              <AppIcon name="film" className="h-4 w-4" />
              {t('eyebrow')}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--glass-text-primary)]">{t('title')}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--glass-text-secondary)]">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-xs text-[var(--glass-text-secondary)]">
            <span className={`h-2 w-2 rounded-full ${statusDotClass(taskView.active, taskView.phase === 'failed')}`} />
            {phaseLabel}
          </div>
        </header>

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

        <section className="my-6 flex flex-col items-center rounded-3xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-5 py-5 text-center">
          <p className="mb-4 text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('workflowNote')}</p>
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
        </section>

        <section className="glass-surface overflow-hidden rounded-3xl border border-[var(--glass-stroke-base)]">
          <div className="flex items-center justify-between border-b border-[var(--glass-stroke-base)] px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('result.title')}</h2>
              <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('result.description')}</p>
            </div>
            {taskView.videoUrl ? (
              <a
                href={taskView.videoUrl}
                download
                className="glass-btn-base px-4 py-2 text-sm"
              >
                <AppIcon name="download" className="h-4 w-4" />
                {t('actions.download')}
              </a>
            ) : null}
          </div>

          {taskView.videoUrl ? (
            <div className="p-5">
              <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-black">
                <video key={taskView.videoUrl} src={taskView.videoUrl} controls preload="metadata" className="aspect-video w-full object-contain" />
              </div>
            </div>
          ) : (
            <div className="flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center">
              <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]">
                <AppIcon name={taskView.active ? 'loader' : taskView.phase === 'failed' ? 'alert' : 'clapperboard'} className={`h-8 w-8 ${taskView.active ? 'animate-spin' : ''}`} />
              </span>
              <p className="text-sm font-semibold text-[var(--glass-text-primary)]">{phaseLabel}</p>
              <p className="mt-2 max-w-md text-xs leading-5 text-[var(--glass-text-tertiary)]">
                {taskView.errorMessage || (taskView.active ? t('result.processingHint') : t('result.emptyHint'))}
              </p>
            </div>
          )}
        </section>

        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--glass-text-secondary)]">{t('history.title')}</h2>
            <button type="button" onClick={() => void fetchTasks()} className="text-xs text-[var(--glass-tone-info-fg)] hover:underline">
              {t('actions.refresh')}
            </button>
          </div>
          {tasks.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {tasks.map((task) => {
                const view = resolveVideoToolTaskView(task)
                const trimFrames = resolveVideoToolTaskTrimFrames(task)
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setSelectedTaskId(task.id)}
                    className={`glass-surface rounded-2xl border p-4 text-left transition-colors ${currentTask?.id === task.id
                      ? 'border-[var(--glass-tone-info-fg)]/60'
                      : 'border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-strong)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-[var(--glass-text-primary)]">{t(`status.${view.phase}`)}</span>
                      <span className={`h-2 w-2 rounded-full ${statusDotClass(view.active, view.phase === 'failed')}`} />
                    </div>
                    <dl className="mt-3 space-y-1 text-[11px] text-[var(--glass-text-secondary)]">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="truncate">{t('history.input1TrimLabel')}</dt>
                        <dd className="font-medium tabular-nums">{trimFrames.input1TrimEndFrames}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="truncate">{t('history.input2TrimLabel')}</dt>
                        <dd className="font-medium tabular-nums">{trimFrames.input2TrimStartFrames}</dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-[11px] text-[var(--glass-text-tertiary)]">{new Date(task.createdAt).toLocaleString()}</p>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-[var(--glass-stroke-base)] py-8 text-center text-xs text-[var(--glass-text-tertiary)]">
              {t('history.empty')}
            </p>
          )}
        </section>
      </main>
    </div>
  )
}
