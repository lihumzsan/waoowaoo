import type { PlannedTask, PlannedTaskEdge } from './plan-contract'

export function assertValidOperationPlanTaskEdges(
  tasks: readonly Pick<PlannedTask, 'id'>[],
  edges: readonly PlannedTaskEdge[],
): void {
  const ids = new Set(tasks.map((task) => task.id))
  if (ids.size !== tasks.length) {
    throw new Error('OPERATION_PLAN_TASK_IDENTITIES_INVALID')
  }

  const indegree = new Map([...ids].map((id) => [id, 0]))
  const outgoing = new Map([...ids].map((id) => [id, [] as string[]]))
  const edgeKeys = new Set<string>()

  for (const edge of edges) {
    if (!ids.has(edge.sourceTaskPlanId) || !ids.has(edge.targetTaskPlanId)) {
      throw new Error('OPERATION_PLAN_TASK_EDGE_ENDPOINT_INVALID')
    }
    if (edge.sourceTaskPlanId === edge.targetTaskPlanId) {
      throw new Error('OPERATION_PLAN_TASK_EDGE_SELF_REFERENCE')
    }
    if (edge.requirement !== 'required_success') {
      throw new Error('OPERATION_PLAN_TASK_EDGE_REQUIREMENT_INVALID')
    }

    const edgeKey = `${edge.sourceTaskPlanId}\u0000${edge.targetTaskPlanId}`
    if (edgeKeys.has(edgeKey)) {
      throw new Error('OPERATION_PLAN_TASK_EDGE_DUPLICATE')
    }
    edgeKeys.add(edgeKey)
    outgoing.get(edge.sourceTaskPlanId)?.push(edge.targetTaskPlanId)
    indegree.set(
      edge.targetTaskPlanId,
      (indegree.get(edge.targetTaskPlanId) ?? 0) + 1,
    )
  }

  const ready = [...indegree]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort()
  let visited = 0

  while (ready.length > 0) {
    const id = ready.shift()
    if (id === undefined) break
    visited += 1
    for (const target of [...(outgoing.get(id) ?? [])].sort()) {
      const degree = (indegree.get(target) ?? 0) - 1
      indegree.set(target, degree)
      if (degree === 0) ready.push(target)
    }
    ready.sort()
  }

  if (visited !== tasks.length) {
    throw new Error('OPERATION_PLAN_TASK_EDGE_CYCLE')
  }
}
