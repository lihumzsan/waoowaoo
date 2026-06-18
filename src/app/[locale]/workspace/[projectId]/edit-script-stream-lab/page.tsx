import EditScriptStreamLabClient from './edit-script-stream-lab-client'

export default async function EditScriptStreamLabPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>
}) {
  const { projectId } = await params
  return <EditScriptStreamLabClient projectId={projectId} />
}
