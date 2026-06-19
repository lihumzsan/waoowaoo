import { Prisma } from '@prisma/client'

export type WorkflowLabIdMap = Map<string, string>

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
