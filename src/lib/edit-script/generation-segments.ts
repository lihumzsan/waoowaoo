import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { normalizeEditScriptStructure } from './normalize'
import type { EditGenerationSegment, EditScriptPayload, EditScriptShot } from './types'
import { readProjectEditScript } from './service'
import { assertNoRunningVideoGroupOverlap } from './video-group-running-guard'

interface PersistedEditScript {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly status: string
  readonly corePlanJson: Prisma.JsonValue | null
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function requireReadyScript(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
}): Promise<PersistedEditScript> {
  const script = await prisma.projectEditScript.findFirst({
    where: {
      id: input.editScriptId,
      projectId: input.projectId,
      episodeId: input.episodeId,
    },
    select: {
      id: true,
      projectId: true,
      episodeId: true,
      status: true,
      corePlanJson: true,
    },
  })
  if (!script) throw new ApiError('NOT_FOUND')
  if (script.status !== 'ready') {
    throw new ApiError('CONFLICT', {
      code: 'EDIT_SCRIPT_NOT_READY',
      message: 'Edit core plan must be ready before editing generation segments',
    })
  }
  if (!script.corePlanJson) throw new Error(`EDIT_SCRIPT_CORE_PLAN_REQUIRED:${script.id}`)
  return script
}

function assertSegmentsCoverShots(
  shots: readonly EditScriptShot[],
  segments: readonly EditGenerationSegment[],
): void {
  const expected = shots.map((shot) => shot.shotNumber)
  const actual = segments.flatMap((segment) => segment.shotNumbers)
  if (actual.length !== expected.length) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_GENERATION_SEGMENT_COVERAGE_INVALID',
    })
  }
  actual.forEach((shotNumber, index) => {
    if (shotNumber !== expected[index]) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'EDIT_SCRIPT_GENERATION_SEGMENT_ORDER_INVALID',
      })
    }
  })
  segments.forEach((segment) => {
    segment.shotNumbers.forEach((shotNumber, index) => {
      if (index > 0 && shotNumber !== segment.shotNumbers[index - 1] + 1) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'EDIT_SCRIPT_GENERATION_SEGMENT_NOT_CONTINUOUS',
        })
      }
    })
  })
}

async function persistSegments(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly segments: readonly EditGenerationSegment[]
}): Promise<EditScriptPayload> {
  const script = await requireReadyScript(input)
  const core = normalizeEditScriptStructure(script.corePlanJson)
  assertSegmentsCoverShots(core.shots, input.segments)
  await assertNoRunningVideoGroupOverlap({
    projectId: input.projectId,
    episodeId: input.episodeId,
    shotNumbers: core.shots.map((shot) => shot.shotNumber),
    errorCode: 'EDIT_SCRIPT_GENERATION_SEGMENT_LOCKED_BY_RUNNING_VIDEO',
  })
  await prisma.projectEditScript.update({
    where: { id: script.id },
    data: {
      corePlanJson: toInputJson({
        shots: core.shots,
        generationSegments: input.segments,
      }),
    },
  })
  const updated = await readProjectEditScript({
    projectId: input.projectId,
    episodeId: input.episodeId,
  })
  if (!updated) throw new ApiError('NOT_FOUND')
  return updated
}

export async function updateProjectEditScriptGenerationSegmentContinuity(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly segmentIndex: number
  readonly continuity: string
}): Promise<EditScriptPayload> {
  const script = await requireReadyScript(input)
  const core = normalizeEditScriptStructure(script.corePlanJson)
  const target = core.generationSegments[input.segmentIndex]
  if (!target) throw new ApiError('INVALID_PARAMS')
  const segments = core.generationSegments.map((segment, index) => (
    index === input.segmentIndex
      ? { shotNumbers: segment.shotNumbers, continuity: input.continuity.trim() }
      : segment
  ))
  return await persistSegments({
    projectId: input.projectId,
    episodeId: input.episodeId,
    editScriptId: input.editScriptId,
    segments,
  })
}

export async function arrangeProjectEditScriptGenerationSegments(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly segments: readonly EditGenerationSegment[]
}): Promise<EditScriptPayload> {
  return await persistSegments(input)
}

export async function mergeProjectEditScriptGenerationSegments(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly leftSegmentIndex: number
  readonly rightSegmentIndex: number
}): Promise<EditScriptPayload> {
  if (input.rightSegmentIndex !== input.leftSegmentIndex + 1) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_GENERATION_SEGMENT_MERGE_REQUIRES_ADJACENT_SEGMENTS',
    })
  }
  const script = await requireReadyScript(input)
  const core = normalizeEditScriptStructure(script.corePlanJson)
  const left = core.generationSegments[input.leftSegmentIndex]
  const right = core.generationSegments[input.rightSegmentIndex]
  if (!left || !right) throw new ApiError('INVALID_PARAMS')
  const merged: EditGenerationSegment = {
    shotNumbers: [...left.shotNumbers, ...right.shotNumbers],
    continuity: [left.continuity, right.continuity].filter(Boolean).join('; '),
  }
  const segments = core.generationSegments.flatMap((segment, index): EditGenerationSegment[] => {
    if (index === input.leftSegmentIndex) return [merged]
    if (index === input.rightSegmentIndex) return []
    return [segment]
  })
  return await persistSegments({
    projectId: input.projectId,
    episodeId: input.episodeId,
    editScriptId: input.editScriptId,
    segments,
  })
}
