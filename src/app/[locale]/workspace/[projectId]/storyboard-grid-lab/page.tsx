import StoryboardGridLabClient from './storyboard-grid-lab-client'
import type { Locale } from '@/i18n/routing'

type PageProps = {
  readonly params: Promise<{
    readonly locale: Locale
    readonly projectId: string
  }>
  readonly searchParams: Promise<{
    readonly episode?: string
  }>
}

export default async function StoryboardGridLabPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  return (
    <StoryboardGridLabClient
      locale={resolvedParams.locale}
      projectId={resolvedParams.projectId}
      initialEpisodeId={resolvedSearchParams.episode ?? ''}
    />
  )
}
