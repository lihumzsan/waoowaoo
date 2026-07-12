import { Prisma } from '@prisma/client'

export type WorkflowLabIdMap = Map<string, string>

export interface WorkflowLabCloneMaps {
  readonly allIds: WorkflowLabIdMap
  readonly characterIds: WorkflowLabIdMap
  readonly locationIds: WorkflowLabIdMap
  readonly locationImageIds: WorkflowLabIdMap
  readonly characterAppearanceIds: WorkflowLabIdMap
  readonly storyboardIds: WorkflowLabIdMap
  readonly panelIds: WorkflowLabIdMap
  readonly chapterIds: WorkflowLabIdMap
  readonly bibleIds: WorkflowLabIdMap
  readonly stylePreviewIds: WorkflowLabIdMap
  readonly editScriptIds: WorkflowLabIdMap
  readonly assetRequirementIds: WorkflowLabIdMap
  readonly shotExecutionPlanIds: WorkflowLabIdMap
  readonly videoGroupIds: WorkflowLabIdMap
}

export function createWorkflowLabCloneMaps(): WorkflowLabCloneMaps {
  return {
    allIds: new Map(),
    characterIds: new Map(),
    locationIds: new Map(),
    locationImageIds: new Map(),
    characterAppearanceIds: new Map(),
    storyboardIds: new Map(),
    panelIds: new Map(),
    chapterIds: new Map(),
    bibleIds: new Map(),
    stylePreviewIds: new Map(),
    editScriptIds: new Map(),
    assetRequirementIds: new Map(),
    shotExecutionPlanIds: new Map(),
    videoGroupIds: new Map(),
  }
}

export function mapWorkflowLabId(params: {
  readonly maps: WorkflowLabCloneMaps
  readonly scopedMap: WorkflowLabIdMap
  readonly sourceId: string
  readonly targetId: string
}) {
  params.scopedMap.set(params.sourceId, params.targetId)
  params.maps.allIds.set(params.sourceId, params.targetId)
}

export function toNullableInputJson(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue
}

export function toInputJson(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

export function readMappedId(idMap: WorkflowLabIdMap, sourceId: string): string {
  const mappedId = idMap.get(sourceId)
  if (!mappedId) throw new Error(`WORKFLOW_LAB_ID_MAP_MISSING:${sourceId}`)
  return mappedId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function addWorkflowLabPlanTargetReplacements(params: {
  readonly planSnapshot: unknown
  readonly replacements: Map<string, string>
  readonly createId?: () => string
}): void {
  if (!isRecord(params.planSnapshot) || !Array.isArray(params.planSnapshot.tasks)) return
  const createId = params.createId ?? (() => crypto.randomUUID())
  const reservedIdentityIds = Array.isArray(params.planSnapshot.reservedIdentityIds)
    ? params.planSnapshot.reservedIdentityIds
    : []
  for (const value of reservedIdentityIds) {
    const identityId = typeof value === 'string' ? value.trim() : ''
    if (!identityId || params.replacements.has(identityId)) continue
    params.replacements.set(identityId, createId())
  }
  for (const task of params.planSnapshot.tasks) {
    if (!isRecord(task) || !isRecord(task.target)) continue
    const targetId = typeof task.target.targetId === 'string' ? task.target.targetId.trim() : ''
    if (!targetId || params.replacements.has(targetId)) continue
    params.replacements.set(targetId, createId())
  }
}
