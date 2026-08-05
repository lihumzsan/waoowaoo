'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import { BrandLoading } from '@/components/ui/BrandLoading'
import ProjectWorkspace from '@/features/project-workspace/ProjectWorkspace'
import { useRouter } from '@/i18n/navigation'
import { useProjectData } from '@/lib/query/hooks'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'
import {
  HOME_ASSISTANT_AUTOSTART_QUERY,
  HOME_ASSISTANT_AUTOSTART_VALUE,
  readHomeAssistantAutoStartDraft,
  removeHomeAssistantAutoStartDraft,
} from '@/lib/home/create-project-launch'
import InAppAnnouncementHost from '@/components/announcements/InAppAnnouncementHost'

export default function ProjectDetailPage() {
  const params = useParams<{ projectId?: string }>()
  const searchParams = useSearchParams()
  const searchParamsValue = searchParams?.toString() ?? ''
  const router = useRouter()
  const t = useTranslations('workspaceDetail')
  const resolveClientError = useClientErrorMessage()
  if (!params?.projectId) throw new Error('ProjectDetailPage requires projectId route param')
  const projectId = params.projectId
  const shouldAutoStartAssistant =
    new URLSearchParams(searchParamsValue).get(HOME_ASSISTANT_AUTOSTART_QUERY)
      === HOME_ASSISTANT_AUTOSTART_VALUE
  const assistantAutoStartDraft = useMemo(
    () => shouldAutoStartAssistant ? readHomeAssistantAutoStartDraft(projectId) : null,
    [projectId, shouldAutoStartAssistant],
  )
  const assistantAutoStartKey = shouldAutoStartAssistant
    ? `${projectId}:home-input`
    : null
  const clearAssistantAutoStart = useCallback(() => {
    removeHomeAssistantAutoStartDraft(projectId)
    const next = new URLSearchParams(searchParamsValue)
    next.delete(HOME_ASSISTANT_AUTOSTART_QUERY)
    router.replace({
      pathname: `/workspace/${projectId}`,
      query: Object.fromEntries(next.entries()),
    }, { scroll: false })
  }, [projectId, router, searchParamsValue])
  useEffect(() => {
    if (!shouldAutoStartAssistant || assistantAutoStartDraft) return
    clearAssistantAutoStart()
  }, [assistantAutoStartDraft, clearAssistantAutoStart, shouldAutoStartAssistant])
  const { data: project, isLoading, error } = useProjectData(projectId)
  if (isLoading) {
    return (
      <div className="glass-page flex h-[100dvh] flex-col overflow-hidden">
        <Navbar />
        <main className="flex min-h-0 flex-1 items-center justify-center"><BrandLoading /></main>
      </div>
    )
  }
  if (error || !project) {
    return (
      <div className="glass-page min-h-screen">
        <Navbar />
        <main className="container mx-auto px-4 py-8">
          <div className="glass-surface p-6 text-center">
            <p className="mb-4 text-[var(--glass-tone-danger-fg)]">
              {error ? resolveClientError(error, t('projectLoadFailed')) : t('projectNotFound')}
            </p>
            <button type="button" onClick={() => router.push({ pathname: '/workspace' })} className="glass-btn-base glass-btn-primary px-6 py-2">
              {t('backToWorkspace')}
            </button>
          </div>
        </main>
      </div>
    )
  }
  return (
    <div className="glass-page flex h-[100dvh] flex-col overflow-hidden">
      <Navbar reserveLayoutSpace={false} dockAnchor="assistant-panel" />
      <main className="min-h-0 flex-1 overflow-hidden">
        <ProjectWorkspace
          project={project}
          projectId={projectId}
          assistantAutoStartDraft={assistantAutoStartDraft}
          assistantAutoStartKey={assistantAutoStartKey}
          onAssistantAutoStartConsumed={clearAssistantAutoStart}
        />
      </main>
      <InAppAnnouncementHost placement="workspace_canvas" />
    </div>
  )
}
