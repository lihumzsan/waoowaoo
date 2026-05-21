import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import DemoProjectCanvas from '@/features/demo/DemoProjectCanvas'
import { demoProjectSlugs, getDemoProjectSnapshot } from '@/lib/demo/demo-registry'
export function generateStaticParams() {
  return demoProjectSlugs.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const snapshot = getDemoProjectSnapshot(slug)
  if (!snapshot) return {}

  return {
    title: `${snapshot.project.name} · ${snapshot.episode.name}`,
  }
}

export default async function DemoProjectPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>
}) {
  const { slug } = await params
  const snapshot = getDemoProjectSnapshot(slug)
  if (!snapshot) notFound()

  return <DemoProjectCanvas snapshot={snapshot} />
}
