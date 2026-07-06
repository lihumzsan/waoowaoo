'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { EpisodeSelector } from '@/components/ui/CapsuleNav'
import { AppIcon } from '@/components/ui/icons'
import { SettingsModal, WorldContextModal } from '@/components/ui/ConfigModals'
import type { ProjectEditChapter, ProjectPanel } from '@/types/project'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { resolveEpisodeArtifactReadiness } from '@/lib/project-workflow/episode-artifact-readiness'
import {
  WORKSPACE_SCOPE_ALL_ID,
  workspaceChapterScopeId,
  type WorkspaceScopeId,
} from '../workspace-scope'
import {
  buildEpisodePlanningOverview,
  formatEpisodePlanningDuration,
  type EpisodePlanningBibleSource,
  type EpisodePlanningOverview,
} from '../episode-planning-overview'

interface EpisodeSummary {
  id: string
  name: string
  episodeNumber?: number
  description?: string | null
  novelText?: string | null
  chapters?: ProjectEditChapter[] | null
  editBible?: EpisodePlanningBibleSource | null
  editScript?: {
    content?: string | null
    scriptText?: string | null
    bible?: string | null
  } | null
  storyboards?: Array<{
    panels?: ProjectPanel[] | null
  }>
}

interface UserModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
}

interface UserModelsPayload {
  llm: UserModelOption[]
  image: UserModelOption[]
  video: UserModelOption[]
  music: UserModelOption[]
}

interface WorkspaceHeaderShellProps {
  isSettingsModalOpen: boolean
  isWorldContextModalOpen: boolean
  onCloseSettingsModal: () => void
  onCloseWorldContextModal: () => void
  availableModels?: UserModelsPayload
  modelsLoaded: boolean
  analysisModel: string | null | undefined
  characterModel: string | null | undefined
  locationModel: string | null | undefined
  storyboardModel: string | null | undefined
  editModel: string | null | undefined
  videoModel: string | null | undefined
  singleShotVideoModel: string | null | undefined
  sequenceVideoModel: string | null | undefined
  musicModel: string | null | undefined
  capabilityOverrides: CapabilitySelections
  videoRatio: string | null | undefined
  onUpdateConfig: (key: string, value: unknown) => Promise<void>
  onUpdateConfigPatch: (patch: Record<string, unknown>) => Promise<void>
  globalAssetText: string
  projectName: string
  episodes: EpisodeSummary[]
  currentEpisodeId?: string
  onEpisodeSelect?: (episodeId: string) => void
  onEpisodeCreate?: () => void
  onEpisodeRename?: (episodeId: string, newName: string) => void
  onEpisodeDelete?: (episodeId: string) => void
  onProjectRename?: (newName: string) => void | Promise<void>
  projectConfigurable: boolean
  currentEditBible?: EpisodePlanningBibleSource | null
  currentWorkflow?: EditFirstWorkflowState | null
  workspaceChapters?: readonly ProjectEditChapter[]
  currentWorkspaceScopeId?: WorkspaceScopeId
  onWorkspaceScopeSelect?: (scopeId: WorkspaceScopeId) => void
}

interface EpisodeSelectorOverviewMetric {
  readonly label: string
  readonly value: string
}

interface EpisodeSelectorOverviewChip {
  readonly label: string
}

interface EpisodeSelectorOverviewChapter {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly indexLabel: string
  readonly meta: readonly string[]
  readonly tone: 'muted' | 'ready' | 'processing' | 'success' | 'danger'
}

interface EpisodeSelectorOverview {
  readonly title: string
  readonly stageLabel: string
  readonly statusTone: 'muted' | 'ready' | 'processing' | 'success' | 'warning' | 'danger'
  readonly metrics: readonly EpisodeSelectorOverviewMetric[]
  readonly chips: readonly EpisodeSelectorOverviewChip[]
  readonly chapters: readonly EpisodeSelectorOverviewChapter[]
  readonly emptyChaptersLabel: string
}

function chapterStatusTone(chapter: ProjectEditChapter): string {
  if (chapter.renderStatus === 'completed') return 'bg-[var(--glass-tone-success-fg)]'
  if (chapter.renderStatus === 'processing' || chapter.status === 'generating') return 'bg-[var(--glass-accent-from)]'
  if (chapter.renderStatus === 'failed' || chapter.status === 'failed') return 'bg-[var(--glass-tone-danger-fg)]'
  if (chapter.status === 'confirmed' || chapter.status === 'ready') return 'bg-[var(--glass-tone-info-fg)]'
  return 'bg-[var(--glass-stroke-strong)]'
}

function resolveOverviewTone(overview: EpisodePlanningOverview): EpisodeSelectorOverview['statusTone'] {
  if (overview.failedChapterCount > 0 || overview.blockingKind === 'failed') return 'danger'
  if (overview.blockingKind === 'processing' || overview.processingChapterCount > 0) return 'processing'
  if (overview.blockingKind === 'needs_user_choice' || overview.blockingKind === 'needs_confirmation') return 'warning'
  if (overview.workflowStage === 'completed') return 'success'
  if (overview.chapterCount > 0 || overview.bibleStatus) return 'ready'
  return 'muted'
}

function resolveChapterTone(chapter: EpisodePlanningOverview['chapters'][number]): EpisodeSelectorOverviewChapter['tone'] {
  if (chapter.status === 'failed' || chapter.renderStatus === 'failed') return 'danger'
  if (chapter.status === 'generating' || chapter.renderStatus === 'processing') return 'processing'
  if (chapter.renderStatus === 'completed') return 'success'
  if (chapter.status === 'confirmed' || chapter.status === 'ready') return 'ready'
  return 'muted'
}

function WorkspaceScopeSelector(props: {
  readonly chapters: readonly ProjectEditChapter[]
  readonly activeId: WorkspaceScopeId
  readonly onSelect?: (scopeId: WorkspaceScopeId) => void
}) {
  const t = useTranslations('projectWorkflow.workspaceScope')
  const buttonClassName = 'inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60'
  const inactiveClassName = 'border-[var(--glass-stroke-base)] bg-white/75 text-[var(--glass-text-secondary)] hover:bg-white hover:text-[var(--glass-text-primary)]'
  const activeClassName = 'border-[var(--glass-stroke-strong)] bg-neutral-900 text-white shadow-sm'
  const itemClassName = (id: WorkspaceScopeId) => `${buttonClassName} ${props.activeId === id ? activeClassName : inactiveClassName}`

  if (props.chapters.length === 0) return null

  return (
    <nav className="fixed left-[330px] right-[420px] top-20 z-40 overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/75 px-2 py-2 shadow-lg backdrop-blur-2xl">
      <div className="flex items-center gap-2 overflow-x-auto app-scrollbar">
        <button
          type="button"
          className={itemClassName(WORKSPACE_SCOPE_ALL_ID)}
          onClick={() => props.onSelect?.(WORKSPACE_SCOPE_ALL_ID)}
        >
          <AppIcon name="grid" className="h-4 w-4" />
          {t('all')}
        </button>
        {props.chapters.map((chapter) => {
          const scopeId = workspaceChapterScopeId(chapter.id)
          return (
            <button
              key={chapter.id}
              type="button"
              className={itemClassName(scopeId)}
              onClick={() => props.onSelect?.(scopeId)}
              title={chapter.title}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${chapterStatusTone(chapter)}`} />
              <span className="max-w-[160px] truncate">
                {t('chapter', { index: chapter.chapterIndex + 1 })}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default function WorkspaceHeaderShell({
  isSettingsModalOpen,
  isWorldContextModalOpen,
  onCloseSettingsModal,
  onCloseWorldContextModal,
  availableModels,
  modelsLoaded,
  analysisModel,
  characterModel,
  locationModel,
  storyboardModel,
  editModel,
  videoModel,
  singleShotVideoModel,
  sequenceVideoModel,
  musicModel,
  capabilityOverrides,
  videoRatio,
  onUpdateConfig,
  onUpdateConfigPatch,
  globalAssetText,
  projectName,
  episodes,
  currentEpisodeId,
  onEpisodeSelect,
  onEpisodeCreate,
  onEpisodeRename,
  onEpisodeDelete,
  onProjectRename,
  projectConfigurable,
  currentEditBible = null,
  currentWorkflow = null,
  workspaceChapters = [],
  currentWorkspaceScopeId = WORKSPACE_SCOPE_ALL_ID,
  onWorkspaceScopeSelect,
}: WorkspaceHeaderShellProps) {
  const overviewT = useTranslations('projectWorkflow.episodeOverview')
  const workflowStageT = useTranslations('projectWorkflow.workflowStages')
  const handleCapabilityOverridesChange = useCallback((value: CapabilitySelections) => {
    void onUpdateConfig('capabilityOverrides', value)
  }, [onUpdateConfig])
  const handleConfigPatch = useCallback((patch: Record<string, unknown>) => {
    void onUpdateConfigPatch(patch)
  }, [onUpdateConfigPatch])

  const chapterPlanStatusLabel = useCallback((status: string) => {
    if (status === 'confirmed') return overviewT('chapterStatus.confirmed')
    if (status === 'ready') return overviewT('chapterStatus.ready')
    if (status === 'generating') return overviewT('chapterStatus.generating')
    if (status === 'failed') return overviewT('chapterStatus.failed')
    if (status === 'pending') return overviewT('chapterStatus.pending')
    return status || overviewT('unknown')
  }, [overviewT])

  const chapterRenderStatusLabel = useCallback((status: string | null) => {
    if (!status) return overviewT('renderStatus.empty')
    if (status === 'completed') return overviewT('renderStatus.completed')
    if (status === 'processing') return overviewT('renderStatus.processing')
    if (status === 'failed') return overviewT('renderStatus.failed')
    if (status === 'pending') return overviewT('renderStatus.pending')
    return status
  }, [overviewT])

  const toEpisodeSelectorOverview = useCallback((overview: EpisodePlanningOverview): EpisodeSelectorOverview => ({
    title: overview.bible.title ? overviewT('titleWithBible', { title: overview.bible.title }) : overviewT('title'),
    stageLabel: workflowStageT(overview.workflowStage),
    statusTone: resolveOverviewTone(overview),
    metrics: [
      { label: overviewT('chapters'), value: String(overview.chapterCount) },
      { label: overviewT('targetDuration'), value: formatEpisodePlanningDuration(overview.targetDurationSec) },
      { label: overviewT('confirmed'), value: String(overview.confirmedChapterCount) },
      { label: overviewT('rendered'), value: String(overview.renderedChapterCount) },
      { label: overviewT('failed'), value: String(overview.failedChapterCount) },
      { label: overviewT('episodePlan'), value: overview.bibleStatus ? overviewT('bibleStatus', { status: overview.bibleStatus }) : overviewT('emptyValue') },
    ],
    chips: [
      { label: overviewT('characters', { count: overview.bible.characterCount }) },
      { label: overviewT('locations', { count: overview.bible.locationCount }) },
      { label: overviewT('beats', { count: overview.bible.beatCount }) },
      { label: overviewT('ledgerEvents', { count: overview.bible.ledgerEventCount }) },
      { label: overviewT('emotionalCues', { count: overview.bible.emotionalCueCount }) },
      { label: overviewT('worldRules', { count: overview.bible.worldRuleCount }) },
    ],
    chapters: overview.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      indexLabel: overviewT('chapterIndex', { index: chapter.chapterIndex + 1 }),
      tone: resolveChapterTone(chapter),
      meta: [
        overviewT('chapterDuration', { duration: formatEpisodePlanningDuration(chapter.targetDurationSec) }),
        overviewT('chapterPlanStatus', { status: chapterPlanStatusLabel(chapter.status) }),
        overviewT('chapterRenderStatus', { status: chapterRenderStatusLabel(chapter.renderStatus) }),
      ],
    })),
    emptyChaptersLabel: overviewT('emptyChapters'),
  }), [chapterPlanStatusLabel, chapterRenderStatusLabel, overviewT, workflowStageT])

  return (
    <>
      {projectConfigurable && (
        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={onCloseSettingsModal}
          availableModels={availableModels}
          modelsLoaded={modelsLoaded}
          analysisModel={analysisModel ?? undefined}
          characterModel={characterModel ?? undefined}
          locationModel={locationModel ?? undefined}
          imageModel={storyboardModel ?? undefined}
          editModel={editModel ?? undefined}
          videoModel={videoModel ?? undefined}
          singleShotVideoModel={singleShotVideoModel ?? videoModel ?? undefined}
          sequenceVideoModel={sequenceVideoModel ?? undefined}
          musicModel={musicModel ?? undefined}
          videoRatio={videoRatio ?? undefined}
          capabilityOverrides={capabilityOverrides}
          onAnalysisModelChange={(value) => { onUpdateConfig('analysisModel', value) }}
          onCharacterModelChange={(value) => { onUpdateConfig('characterModel', value) }}
          onLocationModelChange={(value) => { onUpdateConfig('locationModel', value) }}
          onImageModelChange={(value) => { onUpdateConfig('storyboardModel', value) }}
          onEditModelChange={(value) => { onUpdateConfig('editModel', value) }}
          onVideoModelChange={(value) => { onUpdateConfig('videoModel', value) }}
          onSingleShotVideoModelChange={(value) => { onUpdateConfig('singleShotVideoModel', value) }}
          onSequenceVideoModelChange={(value) => { onUpdateConfig('sequenceVideoModel', value) }}
          onMusicModelChange={(value) => { onUpdateConfig('musicModel', value) }}
          onVideoRatioChange={(value) => { onUpdateConfig('videoRatio', value) }}
          onCapabilityOverridesChange={handleCapabilityOverridesChange}
          onConfigPatch={handleConfigPatch}
        />
      )}

      <WorldContextModal
        isOpen={isWorldContextModalOpen}
        onClose={onCloseWorldContextModal}
        text={globalAssetText}
        onChange={(value) => { onUpdateConfig('globalAssetText', value) }}
      />
      {episodes.length > 0 && currentEpisodeId && (() => {
        const getNum = (name: string) => { const m = name.match(/\d+/); return m ? parseInt(m[0], 10) : Infinity }
        const sorted = [...episodes].sort((a, b) => {
          const d = getNum(a.name) - getNum(b.name)
          return d !== 0 ? d : a.name.localeCompare(b.name, 'zh')
        })
        return (
          <EpisodeSelector
            projectName={projectName}
            episodes={sorted.map((ep) => {
              const episodeEditBible = ep.id === currentEpisodeId
                ? currentEditBible ?? ep.editBible ?? null
                : ep.editBible ?? null
              const episodeChapters = ep.id === currentEpisodeId
                ? workspaceChapters
                : ep.chapters ?? episodeEditBible?.chapters ?? []
              const planningOverview = ep.id === currentEpisodeId || episodeEditBible
                ? buildEpisodePlanningOverview({
                    editBible: episodeEditBible,
                    chapters: episodeChapters,
                    workflow: ep.id === currentEpisodeId ? currentWorkflow : null,
                  })
                : null
              const episodeArtifacts = resolveEpisodeArtifactReadiness({
                novelText: ep.novelText ?? null,
                editScript: ep.editScript ?? null,
                editBible: ep.editBible ?? null,
                storyboards: ep.storyboards || [],
              })
              return {
                id: ep.id,
                title: ep.name,
                summary: ep.description ?? undefined,
                overview: planningOverview ? toEpisodeSelectorOverview(planningOverview) : undefined,
                status: {
                  script: episodeArtifacts.hasScript ? 'ready' as const : 'empty' as const,
                  visual: episodeArtifacts.hasVideo ? 'ready' as const : 'empty' as const,
                },
              }
            })}
            currentId={currentEpisodeId}
            onSelect={(id) => onEpisodeSelect?.(id)}
            onAdd={onEpisodeCreate}
            onRename={(id, newName) => onEpisodeRename?.(id, newName)}
            onDelete={onEpisodeDelete}
            onProjectRename={onProjectRename}
          />
        )
      })()}
      {currentEpisodeId ? (
        <WorkspaceScopeSelector
          chapters={workspaceChapters}
          activeId={currentWorkspaceScopeId}
          onSelect={onWorkspaceScopeSelect}
        />
      ) : null}

    </>
  )
}
