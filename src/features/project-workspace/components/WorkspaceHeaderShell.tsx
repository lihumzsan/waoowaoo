'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { EpisodeSelector } from '@/components/ui/CapsuleNav'
import { SettingsModal, WorldContextModal } from '@/components/ui/ConfigModals'
import type { ProjectEditChapter } from '@/types/project'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import {
  WORKSPACE_SCOPE_ALL_ID,
  workspaceChapterScopeId,
  type WorkspaceScopeId,
} from '../workspace-scope'
import {
  buildEpisodePlanningOverview,
  formatEpisodePlanningDuration,
  type EpisodePlanningStoryCanonSource,
  type EpisodePlanningOverview,
} from '../episode-planning-overview'

interface EpisodeSummary {
  id: string
  name: string
  episodeNumber?: number
  description?: string | null
  novelText?: string | null
  chapters?: ProjectEditChapter[] | null
  storyCanon?: EpisodePlanningStoryCanonSource | null
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
  editModel: string | null | undefined
  videoModel: string | null | undefined
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
  currentStoryCanon?: EpisodePlanningStoryCanonSource | null
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
  readonly summaryLabel: string
  readonly statusTone: 'muted' | 'ready' | 'processing' | 'success' | 'danger'
  readonly metrics: readonly EpisodeSelectorOverviewMetric[]
  readonly chips: readonly EpisodeSelectorOverviewChip[]
  readonly chapters: readonly EpisodeSelectorOverviewChapter[]
  readonly emptyChaptersLabel: string
}

function resolveOverviewTone(overview: EpisodePlanningOverview): EpisodeSelectorOverview['statusTone'] {
  if (overview.chapterCount > 0 || overview.hasStoryCanon) return 'ready'
  return 'muted'
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
  editModel,
  videoModel,
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
  currentStoryCanon = null,
  workspaceChapters = [],
  currentWorkspaceScopeId = WORKSPACE_SCOPE_ALL_ID,
  onWorkspaceScopeSelect,
}: WorkspaceHeaderShellProps) {
  const overviewT = useTranslations('projectWorkflow.episodeOverview')
  const handleCapabilityOverridesChange = useCallback((value: CapabilitySelections) => {
    void onUpdateConfig('capabilityOverrides', value)
  }, [onUpdateConfig])
  const handleConfigPatch = useCallback((patch: Record<string, unknown>) => {
    void onUpdateConfigPatch(patch)
  }, [onUpdateConfigPatch])
  const handleOverviewScopeSelect = useCallback((scopeId: string) => {
    const scope = scopeId === WORKSPACE_SCOPE_ALL_ID || scopeId.startsWith('chapter:')
      ? scopeId as WorkspaceScopeId
      : WORKSPACE_SCOPE_ALL_ID
    onWorkspaceScopeSelect?.(scope)
  }, [onWorkspaceScopeSelect])

  const toEpisodeSelectorOverview = useCallback((overview: EpisodePlanningOverview): EpisodeSelectorOverview => ({
    title: overview.storyCanon.title
      ? overviewT('titleWithStoryCanon', { title: overview.storyCanon.title })
      : overviewT('title'),
    summaryLabel: `${overviewT('chapters')}: ${String(overview.chapterCount)}`,
    statusTone: resolveOverviewTone(overview),
    metrics: [
      { label: overviewT('chapters'), value: String(overview.chapterCount) },
      { label: overviewT('targetDuration'), value: formatEpisodePlanningDuration(overview.targetDurationSec) },
      { label: overviewT('characters', { count: overview.storyCanon.characterCount }), value: String(overview.storyCanon.characterCount) },
      { label: overviewT('locations', { count: overview.storyCanon.locationCount }), value: String(overview.storyCanon.locationCount) },
      { label: overviewT('beats', { count: overview.storyCanon.beatCount }), value: String(overview.storyCanon.beatCount) },
      { label: overviewT('ledgerEvents', { count: overview.storyCanon.ledgerEventCount }), value: String(overview.storyCanon.ledgerEventCount) },
    ],
    chips: [
      { label: overviewT('characters', { count: overview.storyCanon.characterCount }) },
      { label: overviewT('locations', { count: overview.storyCanon.locationCount }) },
      { label: overviewT('beats', { count: overview.storyCanon.beatCount }) },
      { label: overviewT('ledgerEvents', { count: overview.storyCanon.ledgerEventCount }) },
      { label: overviewT('emotionalCues', { count: overview.storyCanon.emotionalCueCount }) },
      { label: overviewT('worldRules', { count: overview.storyCanon.worldRuleCount }) },
    ],
    chapters: overview.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      indexLabel: overviewT('chapterIndex', { index: chapter.chapterIndex + 1 }),
      tone: 'ready',
      meta: [
        overviewT('chapterDuration', { duration: formatEpisodePlanningDuration(chapter.targetDurationSec) }),
      ],
    })),
    emptyChaptersLabel: overviewT('emptyChapters'),
  }), [overviewT])

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
          editModel={editModel ?? undefined}
          videoModel={videoModel ?? undefined}
          musicModel={musicModel ?? undefined}
          videoRatio={videoRatio ?? undefined}
          capabilityOverrides={capabilityOverrides}
          onAnalysisModelChange={(value) => { onUpdateConfig('analysisModel', value) }}
          onCharacterModelChange={(value) => { onUpdateConfig('characterModel', value) }}
          onLocationModelChange={(value) => { onUpdateConfig('locationModel', value) }}
          onEditModelChange={(value) => { onUpdateConfig('editModel', value) }}
          onVideoModelChange={(value) => { onUpdateConfig('videoModel', value) }}
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
              const episodeStoryCanon = ep.id === currentEpisodeId
                ? currentStoryCanon ?? ep.storyCanon ?? null
                : ep.storyCanon ?? null
              const episodeChapters = ep.id === currentEpisodeId
                ? workspaceChapters
                : ep.chapters ?? episodeStoryCanon?.chapters ?? []
              const planningOverview = ep.id === currentEpisodeId || episodeStoryCanon
                ? buildEpisodePlanningOverview({
                    storyCanon: episodeStoryCanon,
                    chapters: episodeChapters,
                  })
                : null
              return {
                id: ep.id,
                title: ep.name,
                summary: ep.description ?? undefined,
                overview: planningOverview ? toEpisodeSelectorOverview(planningOverview) : undefined,
              }
            })}
            currentId={currentEpisodeId}
            onSelect={(id) => onEpisodeSelect?.(id)}
            onAdd={onEpisodeCreate}
            onRename={(id, newName) => onEpisodeRename?.(id, newName)}
            onDelete={onEpisodeDelete}
            onProjectRename={onProjectRename}
            currentOverviewScopeId={currentWorkspaceScopeId}
            allOverviewScopeId={WORKSPACE_SCOPE_ALL_ID}
            getChapterOverviewScopeId={workspaceChapterScopeId}
            onOverviewScopeSelect={handleOverviewScopeSelect}
          />
        )
      })()}

    </>
  )
}
