import ContinuityLabClient from './continuity-lab-client'

export default async function ContinuityLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolved = await searchParams
  const projectId = typeof resolved.projectId === 'string' ? resolved.projectId.trim() : ''
  return <ContinuityLabClient projectId={projectId} />
}
