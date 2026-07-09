'use client'
import { apiFetch } from '@/lib/api-fetch'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import { BrandLoading } from '@/components/ui/BrandLoading'
import { useProjectData, useEpisodeData } from '@/lib/query/hooks'
import { queryKeys } from '@/lib/query/keys'
import ProjectWorkspace from '@/features/project-workspace/ProjectWorkspace'
import { resolveSelectedEpisodeId } from './episode-selection'
import { useRouter } from '@/i18n/navigation'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { resolveWorkspacePageState } from './workspace-page-state'
import {
  HOME_ASSISTANT_AUTOSTART_QUERY,
  HOME_ASSISTANT_AUTOSTART_VALUE,
  readHomeAssistantAutoStartDraft,
  removeHomeAssistantAutoStartDraft,
} from '@/lib/home/create-project-launch'

interface Episode {
  id: string
  episodeNumber: number
  name: string
  description?: string | null
  novelText?: string | null
  audioUrl?: string | null
  srtContent?: string | null
  createdAt: string
}

/**
 * 项目详情页 - 带侧边栏的剧集管理
 */
export default function ProjectDetailPage() {
  const params = useParams<{ projectId?: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  if (!params?.projectId) {
    throw new Error('ProjectDetailPage requires projectId route param')
  }
  if (!searchParams) {
    throw new Error('ProjectDetailPage requires searchParams')
  }
  const projectId = params.projectId
  const t = useTranslations('workspaceDetail')

  // 从URL读取参数
  const urlEpisodeId = searchParams.get('episode') ?? null
  const shouldAutoStartAssistant = searchParams.get(HOME_ASSISTANT_AUTOSTART_QUERY) === HOME_ASSISTANT_AUTOSTART_VALUE
  const workflowLabEnabled = searchParams.get('workflowLab') === '1'

  // 🔥 React Query 数据获取
  const queryClient = useQueryClient()
  const { data: project, isLoading: loading, error: projectError } = useProjectData(projectId)
  const error = projectError?.message || null

  // 视图状态（仅 UI）
  const [isGlobalAssetsView, setIsGlobalAssetsView] = useState(false)

  const updateUrlParams = useCallback((updates: {
    episode?: string | null
    assistantAutoStart?: string | null
  }) => {
    const params = new URLSearchParams(searchParams.toString())
    if (updates.episode !== undefined) {
      if (updates.episode) {
        params.set('episode', updates.episode)
      } else {
        params.delete('episode')
      }
    }
    if (updates.assistantAutoStart !== undefined) {
      if (updates.assistantAutoStart) {
        params.set(HOME_ASSISTANT_AUTOSTART_QUERY, updates.assistantAutoStart)
      } else {
        params.delete(HOME_ASSISTANT_AUTOSTART_QUERY)
      }
    }
    const query = Object.fromEntries(params.entries())
    router.replace(
      {
        pathname: `/workspace/${projectId}`,
        query,
      },
      { scroll: false },
    )
  }, [router, projectId, searchParams])

  // 获取剧集列表
  const episodes = useMemo<Episode[]>(() => {
    const getNum = (name: string) => { const m = name.match(/\d+/); return m ? parseInt(m[0], 10) : Infinity }
    return (project?.episodes ?? []).map((episode) => ({
      ...episode,
      createdAt: typeof episode.createdAt === 'string' ? episode.createdAt : episode.createdAt.toISOString(),
    })).sort((a, b) => {
      const diff = getNum(a.name) - getNum(b.name)
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'zh')
    })
  }, [project?.episodes])

  // 剧集导航状态单源：URL（无本地副本）
  const selectedEpisodeId = useMemo(
    () => resolveSelectedEpisodeId(episodes, urlEpisodeId),
    [episodes, urlEpisodeId],
  )

  // 🔥 使用 React Query 获取剧集数据
  const { data: currentEpisode, isLoading: episodeLoading, error: episodeError } = useEpisodeData(
    projectId,
    !isGlobalAssetsView ? selectedEpisodeId : null
  )
  const assistantAutoStartDraft = useMemo(() => (
    shouldAutoStartAssistant && selectedEpisodeId
      ? readHomeAssistantAutoStartDraft(projectId, selectedEpisodeId)
      : null
  ), [projectId, selectedEpisodeId, shouldAutoStartAssistant])
  const assistantAutoStartKey = shouldAutoStartAssistant && selectedEpisodeId
    ? `${projectId}:${selectedEpisodeId}:home-input`
    : null
  const clearAssistantAutoStart = useCallback(() => {
    if (selectedEpisodeId) {
      removeHomeAssistantAutoStartDraft(projectId, selectedEpisodeId)
    }
    updateUrlParams({ assistantAutoStart: null })
  }, [projectId, selectedEpisodeId, updateUrlParams])

  useEffect(() => {
    if (!shouldAutoStartAssistant || !selectedEpisodeId || assistantAutoStartDraft) return
    clearAssistantAutoStart()
  }, [assistantAutoStartDraft, clearAssistantAutoStart, selectedEpisodeId, shouldAutoStartAssistant])

  // 零状态：无剧集时自动创建第一集
  const shouldAutoCreateEpisode = episodes.length === 0
  const autoCreateTriggered = useRef(false)

  useEffect(() => {
    if (!shouldAutoCreateEpisode || autoCreateTriggered.current || loading) return
    autoCreateTriggered.current = true
    void handleCreateEpisode(`${t('episode')} 1`)
  }, [shouldAutoCreateEpisode, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // 初始化 URL：无效/缺失 episode 时，统一回写默认 episode
  useEffect(() => {
    if (!project || isGlobalAssetsView || episodes.length === 0) return
    if (urlEpisodeId && episodes.some((episode) => episode.id === urlEpisodeId)) return
    if (selectedEpisodeId) {
      updateUrlParams({ episode: selectedEpisodeId })
    }
  }, [episodes, isGlobalAssetsView, project, selectedEpisodeId, updateUrlParams, urlEpisodeId])

  // 创建剧集
  const handleCreateEpisode = async (name: string, description?: string) => {
    const res = await apiFetch(`/api/projects/${projectId}/episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    })

    if (!res.ok) {
      throw new Error(await readApiErrorMessage(res, t('createFailed')))
    }

    const data = await res.json()
    // 🔥 刷新项目数据获取新的剧集列表
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    // 自动切换到新创建的剧集
    setIsGlobalAssetsView(false)
    // 同步到URL
    updateUrlParams({ episode: data.episode.id })
  }

  // 重命名剧集
  const handleRenameEpisode = async (episodeId: string, newName: string) => {
    const res = await apiFetch(`/api/projects/${projectId}/episodes/${episodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    })

    if (!res.ok) {
      throw new Error(t('renameFailed'))
    }

    // 🔥 刷新项目数据
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    // 剧集详情也刷新
    if (selectedEpisodeId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, selectedEpisodeId) })
    }
  }

  // 重命名项目
  const handleRenameProject = async (newName: string) => {
    if (!project) {
      throw new Error(t('projectNotFound'))
    }

    const res = await apiFetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        description: project.description ?? null,
      }),
    })

    if (!res.ok) {
      throw new Error(await readApiErrorMessage(res, t('renameFailed')))
    }

    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
  }

  // 删除剧集
  const handleDeleteEpisode = async (episodeId: string) => {
    const res = await apiFetch(`/api/projects/${projectId}/episodes/${episodeId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      throw new Error(t('deleteFailed'))
    }
    // 刷新项目数据
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    // 如果删除的是当前正在查看的剧集，切换到其他剧集
    if (episodeId === selectedEpisodeId) {
      const remaining = episodes.filter(ep => ep.id !== episodeId)
      if (remaining.length > 0) {
        updateUrlParams({ episode: remaining[0].id })
      } else {
        updateUrlParams({ episode: null })
      }
    }
  }

  // 选择剧集
  const handleEpisodeSelect = (episodeId: string) => {
    setIsGlobalAssetsView(false)
    // 同步到URL
    updateUrlParams({ episode: episodeId })
  }

  const handleWorkflowLabProjectForked = useCallback(async (params: { projectId: string; episodeId: string }) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(params.projectId) })
    setIsGlobalAssetsView(false)
    router.push({
      pathname: `/workspace/${params.projectId}`,
      query: {
        episode: params.episodeId,
        workflowLab: '1',
      },
    })
  }, [queryClient, router])

  const pageState = resolveWorkspacePageState({
    projectLoading: loading,
    projectError: error,
    hasProject: Boolean(project),
    isGlobalAssetsView,
    episodeCount: episodes.length,
    selectedEpisodeId,
    hasCurrentEpisode: Boolean(currentEpisode),
    episodeLoading,
    episodeError: episodeError?.message || null,
    projectMissingMessage: t('projectNotFound'),
    episodeMissingMessage: t('episodeNotFound'),
  })
  const isEpisodeWorkspaceReady = !isGlobalAssetsView && Boolean(selectedEpisodeId && currentEpisode)
  if (pageState.kind === 'loading') {
    return (
      <div className="glass-page min-h-screen">
        <Navbar />
        <main className="flex items-center justify-center h-[calc(100vh-64px)]">
          <BrandLoading />
        </main>
      </div>
    )
  }

  // Error状态
  if (pageState.kind === 'error' || !project) {
    return (
      <div className="glass-page min-h-screen">
        <Navbar />
        <main className="container mx-auto px-4 py-8">
          <div className="glass-surface p-6 text-center">
            <p className="text-[var(--glass-tone-danger-fg)] mb-4">
              {pageState.kind === 'error' ? pageState.message : t('projectNotFound')}
            </p>
            <button
              onClick={() => router.push({ pathname: '/workspace' })}
              className="glass-btn-base glass-btn-primary px-6 py-2"
            >
              {t('backToWorkspace')}
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className={isEpisodeWorkspaceReady ? 'glass-page flex h-[100dvh] flex-col overflow-hidden' : 'glass-page min-h-screen flex flex-col'}>
      <Navbar reserveLayoutSpace={!isEpisodeWorkspaceReady} />

      {/* V3 UI: 浮动导航替代了旧的 Sidebar */}

      {/* 主内容区 - 占满全部宽度 */}
      <main className={isEpisodeWorkspaceReady ? 'min-h-0 flex-1 overflow-hidden' : 'flex-1 overflow-y-auto'}>
        <div className={isEpisodeWorkspaceReady ? 'h-full w-full overflow-hidden' : 'w-full px-4 py-8'}>
          {isGlobalAssetsView ? (
            // 全局资产视图（确保数据准备好）
            <div>
              <h1 className="text-2xl font-bold text-[var(--glass-text-primary)] mb-6">{t('globalAssets')}</h1>
              <ProjectWorkspace
                project={project}
                projectId={projectId}
                viewMode="global-assets"
              />
            </div>
          ) : selectedEpisodeId && currentEpisode ? (
            // 剧集工作区（确保所有数据都准备好）
            <ProjectWorkspace
              project={project}
              projectId={projectId}
              episodeId={selectedEpisodeId}
              episode={currentEpisode}
              viewMode="episode"
              episodes={episodes}
              assistantAutoStartDraft={assistantAutoStartDraft}
              assistantAutoStartKey={assistantAutoStartKey}
              workflowLabEnabled={workflowLabEnabled}
              onAssistantAutoStartConsumed={clearAssistantAutoStart}
              onWorkflowLabProjectForked={handleWorkflowLabProjectForked}
              onEpisodeSelect={handleEpisodeSelect}
              onEpisodeCreate={() => handleCreateEpisode(`${t('episode')} ${episodes.length + 1}`)}
              onEpisodeRename={handleRenameEpisode}
              onEpisodeDelete={handleDeleteEpisode}
              onProjectRename={handleRenameProject}
            />
          ) : (
            // 加载中
            <BrandLoading className="min-h-[320px]" />
          )}
        </div>
      </main>
    </div>
  )
}
