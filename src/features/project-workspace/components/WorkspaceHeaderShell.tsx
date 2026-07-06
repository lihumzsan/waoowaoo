'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { EpisodeSelector } from '@/components/ui/CapsuleNav'
import { AppIcon } from '@/components/ui/icons'
import { SettingsModal, WorldContextModal } from '@/components/ui/ConfigModals'
import type { ProjectEditChapter, ProjectPanel } from '@/types/project'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import { resolveEpisodeArtifactReadiness } from '@/lib/project-workflow/episode-artifact-readiness'
import {
  WORKSPACE_SCOPE_BIBLE_REVIEW_ID,
  WORKSPACE_SCOPE_OVERVIEW_ID,
  workspaceChapterScopeId,
  type WorkspaceScopeId,
} from '../workspace-scope'

interface EpisodeSummary {
  id: string
  name: string
  episodeNumber?: number
  description?: string | null
  novelText?: string | null
  editScript?: {
    content?: string | null
    scriptText?: string | null
    bible?: string | null
  } | null
  editBible?: {
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
  workspaceChapters?: readonly ProjectEditChapter[]
  currentWorkspaceScopeId?: WorkspaceScopeId
  onWorkspaceScopeSelect?: (scopeId: WorkspaceScopeId) => void
}

function chapterStatusTone(chapter: ProjectEditChapter): string {
  if (chapter.renderStatus === 'completed') return 'bg-[var(--glass-tone-success-fg)]'
  if (chapter.renderStatus === 'generating' || chapter.status === 'generating') return 'bg-[var(--glass-accent-from)]'
  if (chapter.renderStatus === 'failed' || chapter.status === 'failed') return 'bg-[var(--glass-tone-danger-fg)]'
  if (chapter.status === 'confirmed' || chapter.status === 'ready') return 'bg-[var(--glass-tone-info-fg)]'
  return 'bg-[var(--glass-stroke-strong)]'
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

  return (
    <nav className="fixed left-[330px] right-[420px] top-20 z-40 overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/75 px-2 py-2 shadow-lg backdrop-blur-2xl">
      <div className="flex items-center gap-2 overflow-x-auto app-scrollbar">
        <button
          type="button"
          className={itemClassName(WORKSPACE_SCOPE_OVERVIEW_ID)}
          onClick={() => props.onSelect?.(WORKSPACE_SCOPE_OVERVIEW_ID)}
        >
          <AppIcon name="grid" className="h-4 w-4" />
          {t('overview')}
        </button>
        <button
          type="button"
          className={itemClassName(WORKSPACE_SCOPE_BIBLE_REVIEW_ID)}
          onClick={() => props.onSelect?.(WORKSPACE_SCOPE_BIBLE_REVIEW_ID)}
        >
          <AppIcon name="bookOpen" className="h-4 w-4" />
          {t('bibleReview')}
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
  workspaceChapters = [],
  currentWorkspaceScopeId = WORKSPACE_SCOPE_OVERVIEW_ID,
  onWorkspaceScopeSelect,
}: WorkspaceHeaderShellProps) {
  const handleCapabilityOverridesChange = useCallback((value: CapabilitySelections) => {
    void onUpdateConfig('capabilityOverrides', value)
  }, [onUpdateConfig])
  const handleConfigPatch = useCallback((patch: Record<string, unknown>) => {
    void onUpdateConfigPatch(patch)
  }, [onUpdateConfigPatch])

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
