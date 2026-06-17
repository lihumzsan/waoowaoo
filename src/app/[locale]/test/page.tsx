import StoryboardGridLabClient from '../workspace/[projectId]/storyboard-grid-lab/storyboard-grid-lab-client'
import type { Locale } from '@/i18n/routing'

type PageProps = {
  readonly params: Promise<{
    readonly locale: Locale
  }>
  readonly searchParams: Promise<{
    readonly projectId?: string
    readonly episode?: string
  }>
}

export default async function StoryboardGridLabShortcutPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  return (
    <StoryboardGridLabClient
      locale={resolvedParams.locale}
      initialProjectId={resolvedSearchParams.projectId ?? ''}
      initialEpisodeId={resolvedSearchParams.episode ?? ''}
    />
  )
}
