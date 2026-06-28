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
  readonly screenplayIds: WorkflowLabIdMap
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
    screenplayIds: new Map(),
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
