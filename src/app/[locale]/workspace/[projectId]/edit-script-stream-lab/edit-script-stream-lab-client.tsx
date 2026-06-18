'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { Link, useRouter } from '@/i18n/navigation'
import { useProjectData, useProjectEditScript } from '@/lib/query/hooks'
import { resolveSelectedEpisodeId } from '../episode-selection'
import { EditScriptStreamTableCard } from './edit-script-stream-table-card'
import {
  STREAM_EFFECT_MODES,
  sortEpisodes,
  type StreamEffectMode,
  type StreamPhase,
} from './edit-script-stream-types'
import { useEditScriptStreamSimulation } from './use-edit-script-stream-simulation'
import styles from './edit-script-stream-effects.module.css'

const backgroundEffectClass: Record<StreamEffectMode, string> = {
  soft: styles.backgroundSoft,
  scan: styles.backgroundScan,
  hologram: styles.backgroundHologram,
  cascade: styles.backgroundCascade,
}

export default function EditScriptStreamLabClient({ projectId }: { readonly projectId: string }) {
  const labels = useTranslations('projectWorkflow.canvas.workspace.streamLab')
  const fieldLabels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  const nodeLabels = useTranslations('projectWorkflow.canvas.workspace.nodes.editScript')
  const statusLabels = useTranslations('projectWorkflow.canvas.workspace.status')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [effectMode, setEffectMode] = useState<StreamEffectMode>('soft')
  const episodeFromUrl = searchParams?.get('episode') ?? null
  const projectQuery = useProjectData(projectId)
  const episodes = useMemo(
    () => sortEpisodes(projectQuery.data?.episodes ?? []),
    [projectQuery.data?.episodes],
  )
  const selectedEpisodeId = resolveSelectedEpisodeId(episodes, episodeFromUrl)
  const selectedEpisode = episodes.find((episode) => episode.id === selectedEpisodeId) ?? null
  const editScriptQuery = useProjectEditScript(projectId, selectedEpisodeId)
  const editScript = editScriptQuery.data ?? null
  const shots = editScript?.shots ?? []
  const stream = useEditScriptStreamSimulation(
    shots,
    `${selectedEpisodeId ?? 'none'}:${editScript?.id ?? 'none'}:${shots.length}`,
  )
  const phase: StreamPhase = projectQuery.isLoading || editScriptQuery.isLoading
    ? 'loading'
    : !editScript || shots.length === 0
      ? 'empty'
      : stream.isComplete
        ? 'complete'
        : stream.playing
          ? 'streaming'
          : 'paused'

  const handleEpisodeSelect = (episodeId: string) => {
    router.replace(
      {
        pathname: `/workspace/${projectId}/edit-script-stream-lab`,
        query: { episode: episodeId },
      },
      { scroll: false },
    )
  }

  return (
    <main className="min-h-screen bg-slate-100 text-[var(--glass-text-primary)]">
      <div className="flex min-h-screen flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/85 px-5 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={selectedEpisodeId ? `/workspace/${projectId}?episode=${selectedEpisodeId}` : `/workspace/${projectId}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              aria-label={labels('backToWorkspace')}
              title={labels('backToWorkspace')}
            >
              <AppIcon name="chevronLeft" className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{labels('eyebrow')}</p>
              <h1 className="truncate text-lg font-semibold text-slate-950">{labels('title')}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {episodes.length > 1 ? (
              <div className="flex max-w-[min(520px,calc(100vw-32px))] gap-1 overflow-x-auto rounded-[14px] border border-slate-200 bg-white p-1">
                {episodes.map((episode) => (
                  <button
                    key={episode.id}
                    type="button"
                    className={`shrink-0 rounded-[10px] px-2.5 py-1.5 text-xs font-semibold transition ${
                      episode.id === selectedEpisodeId
                        ? 'bg-slate-950 text-white'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                    onClick={() => handleEpisodeSelect(episode.id)}
                  >
                    {episode.name}
                  </button>
                ))}
              </div>
            ) : selectedEpisode ? (
              <span className="rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">
                {selectedEpisode.name}
              </span>
            ) : null}
            <div className="flex gap-1 rounded-[14px] border border-slate-200 bg-white p-1">
              {STREAM_EFFECT_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.modeButton} rounded-[10px] px-2.5 py-1.5 text-xs font-semibold ${
                    effectMode === mode
                      ? 'bg-slate-950 text-white'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                  onClick={() => setEffectMode(mode)}
                >
                  {labels(`effects.${mode}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={shots.length === 0}
              onClick={stream.togglePlay}
            >
              <AppIcon name={stream.playing ? 'pause' : 'play'} className="h-4 w-4" />
              {stream.playing ? labels('pause') : labels('play')}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-[12px] bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={shots.length === 0}
              onClick={stream.replay}
            >
              <AppIcon name="refresh" className="h-4 w-4" />
              {labels('replay')}
            </button>
          </div>
        </header>
        <section className="relative flex flex-1 items-start justify-center overflow-auto p-6">
          <div
            className={`absolute inset-0 opacity-80 ${backgroundEffectClass[effectMode]}`}
          />
          <div className="relative z-10 flex w-full justify-center py-6">
            {phase === 'loading' ? (
              <div className="workspace-node-loading-surface h-[520px] w-[min(760px,calc(100vw-32px))] rounded-[24px] border border-slate-200 bg-slate-100" />
            ) : phase === 'empty' || !editScript ? (
              <div className="w-[min(560px,calc(100vw-32px))] rounded-[24px] border border-slate-200 bg-white p-6 text-center shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[16px] bg-slate-100 text-slate-500">
                  <AppIcon name="clipboardCheck" className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-950">{labels('emptyTitle')}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{labels('emptyBody')}</p>
              </div>
            ) : (
              <EditScriptStreamTableCard
                editScript={editScript}
                visibleShots={stream.visibleShots}
                activeShotNumber={stream.activeShotNumber}
                manualShotNumber={stream.manualShotNumber}
                revealCount={stream.revealCount}
                tableOpen={stream.tableOpen}
                phase={phase}
                onToggleTable={() => stream.setTableOpen((current) => !current)}
                onSelectShot={stream.selectShot}
                labels={labels}
                fieldLabels={fieldLabels}
                nodeLabels={nodeLabels}
                statusLabels={statusLabels}
                effectMode={effectMode}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
