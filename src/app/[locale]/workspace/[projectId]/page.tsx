'use client'

import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import { BrandLoading } from '@/components/ui/BrandLoading'
import ProjectWorkspace from '@/features/project-workspace/ProjectWorkspace'
import { useRouter } from '@/i18n/navigation'
import { useProjectData } from '@/lib/query/hooks'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'

export default function ProjectDetailPage() {
  const params = useParams<{ projectId?: string }>()
  const router = useRouter()
  const t = useTranslations('workspaceDetail')
  const resolveClientError = useClientErrorMessage()
  if (!params?.projectId) throw new Error('ProjectDetailPage requires projectId route param')
  const projectId = params.projectId
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
        <ProjectWorkspace project={project} projectId={projectId} />
      </main>
    </div>
  )
}
