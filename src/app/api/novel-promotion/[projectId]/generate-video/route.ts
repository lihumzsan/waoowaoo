import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { hasPanelVideoOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { parseModelKeyStrict, type CapabilityValue } from '@/lib/model-config-contract'
import { normalizeVideoModelKey } from '@/lib/novel-promotion/video-model-defaults'
import { resolveBerniniCapabilityValidationDuration } from '@/lib/model-capabilities/video-recommended-duration'
import {
  resolveBuiltinCapabilitiesByModelKey,
} from '@/lib/model-capabilities/lookup'
import { resolveBuiltinPricing } from '@/lib/model-pricing/lookup'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import {
  resolvePanelVideoReadinessIssue,
  summarizeVideoReadinessIssues,
  type VideoReadinessPanelLike,
  type VideoReadinessVoiceLine,
} from '@/lib/novel-promotion/video-readiness'
import { parseVideoDurationBinding } from '@/lib/video-duration/audio-binding'
import {
  resolveLtx23WorkflowRoute,
  type Ltx23WorkflowRoutingResult,
} from '@/lib/providers/comfyui/ltx23-workflow-router'
import { normalizeLtx23GoonDurationSeconds } from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import { isRemovedLegacyLtx23WorkflowKey } from '@/lib/providers/comfyui/ltx23-legacy'
import {
  SEEDANCE2_BERNINI_DEFAULT_FPS,
  isSeedance2BerniniWorkflowKey,
} from '@/lib/providers/comfyui/seedance2-bernini-workflow'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function toVideoRuntimeSelections(value: unknown): Record<string, CapabilityValue> {
  if (!isRecord(value)) return {}
  const selections: Record<string, CapabilityValue> = {}
  for (const [field, raw] of Object.entries(value)) {
    if (field === 'aspectRatio') continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      selections[field] = raw
    }
  }
  return selections
}

function resolveVideoGenerationMode(payload: unknown): 'normal' | 'firstlastframe' {
  if (!isRecord(payload)) return 'normal'
  return isRecord(payload.firstLastFrame) ? 'firstlastframe' : 'normal'
}

function isSeedance2Model(modelKey: string): boolean {
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) return false
  return parsed.provider === 'ark'
    && (
      parsed.modelId === 'doubao-seedance-2-0-260128'
      || parsed.modelId === 'doubao-seedance-2-0-fast-260128'
    )
}

function rejectRemovedLegacyLtx23ModelKey(modelKey: string | null | undefined) {
  if (!isRemovedLegacyLtx23WorkflowKey(modelKey)) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_LTX23_WORKFLOW_REMOVED',
    field: 'videoModel',
    details: { model: modelKey },
  })
}

function resolveVideoModelKeyFromPayload(payload: Record<string, unknown>): string | null {
  const firstLast = isRecord(payload.firstLastFrame) ? payload.firstLastFrame : null
  if (firstLast && typeof firstLast.flModel === 'string' && parseModelKeyStrict(firstLast.flModel)) {
    rejectRemovedLegacyLtx23ModelKey(firstLast.flModel)
    return normalizeVideoModelKey(firstLast.flModel)
  }
  if (typeof payload.videoModel === 'string' && parseModelKeyStrict(payload.videoModel)) {
    rejectRemovedLegacyLtx23ModelKey(payload.videoModel)
    return normalizeVideoModelKey(payload.videoModel)
  }
  return null
}

function requireVideoModelKeyFromPayload(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.videoModel !== 'string' || !parseModelKeyStrict(payload.videoModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_MODEL_REQUIRED',
      field: 'videoModel',
    })
  }
  rejectRemovedLegacyLtx23ModelKey(payload.videoModel)
  return normalizeVideoModelKey(payload.videoModel)
}

function normalizeVideoPayloadModelKeys(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {}

  const normalized: Record<string, unknown> = { ...payload }
  if (typeof normalized.videoModel === 'string') {
    normalized.videoModel = normalizeVideoModelKey(normalized.videoModel)
  }
  if (isRecord(normalized.firstLastFrame) && typeof normalized.firstLastFrame.flModel === 'string') {
    normalized.firstLastFrame = {
      ...normalized.firstLastFrame,
      flModel: normalizeVideoModelKey(normalized.firstLastFrame.flModel),
    }
  }
  if (isRecord(normalized.generationOptions) && typeof normalized.videoModel === 'string') {
    normalized.generationOptions = normalizeVideoGenerationOptionsForModel(
      normalized.videoModel,
      normalized.generationOptions,
    )
  }
  return normalized
}

function normalizeVideoGenerationOptionsForModel(
  modelKey: string,
  generationOptions: Record<string, unknown>,
): Record<string, unknown> {
  if (!isSeedance2BerniniWorkflowKey(modelKey)) return generationOptions

  return {
    ...generationOptions,
    fps: SEEDANCE2_BERNINI_DEFAULT_FPS,
  }
}

function normalizeVideoRuntimeSelectionsForModel(
  modelKey: string,
  runtimeSelections: Record<string, CapabilityValue>,
): Record<string, CapabilityValue> {
  if (!isSeedance2BerniniWorkflowKey(modelKey)) return runtimeSelections

  const requestedDuration = readPositiveFiniteNumber(runtimeSelections.duration)
  const durationOptions = resolveBuiltinCapabilitiesByModelKey('video', modelKey)?.video?.durationOptions

  return {
    ...runtimeSelections,
    ...(requestedDuration !== null
      ? {
          duration: resolveBerniniCapabilityValidationDuration(
            modelKey,
            requestedDuration,
            durationOptions,
          ),
        }
      : {}),
    fps: SEEDANCE2_BERNINI_DEFAULT_FPS,
  }
}

function validateFirstLastFrameModel(input: unknown) {
  if (input === undefined || input === null) return
  if (!isRecord(input)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_PAYLOAD_INVALID',
      field: 'firstLastFrame',
    })
  }

  const flModel = input.flModel
  if (typeof flModel !== 'string' || !parseModelKeyStrict(flModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_MODEL_INVALID',
      field: 'firstLastFrame.flModel',
    })
  }

  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', flModel)
  if (capabilities?.video?.firstlastframe !== true) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_MODEL_UNSUPPORTED',
      field: 'firstLastFrame.flModel',
    })
  }
}

async function validateVideoCapabilityCombination(input: {
  payload: unknown
  projectId: string
  userId: string
}) {
  const payload = input.payload
  if (!isRecord(payload)) return
  const modelKey = resolveVideoModelKeyFromPayload(payload)
  if (!modelKey) return

  // Skip validation for models not in the built-in capability catalog
  const builtinCaps = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  if (!builtinCaps) return

  const routing = isRecord(payload.ltx23WorkflowRouting) ? payload.ltx23WorkflowRouting : null
  const capabilityDurationSeconds = readPositiveFiniteNumber(routing?.capabilityDurationSeconds)
  const runtimeSelections = normalizeVideoRuntimeSelectionsForModel(modelKey, {
    ...toVideoRuntimeSelections(payload.generationOptions),
    ...(capabilityDurationSeconds !== null ? { duration: capabilityDurationSeconds } : {}),
    generationMode: resolveVideoGenerationMode(payload),
  })

  let resolvedOptions: Record<string, CapabilityValue>
  try {
    resolvedOptions = await resolveProjectModelCapabilityGenerationOptions({
      projectId: input.projectId,
      userId: input.userId,
      modelType: 'video',
      modelKey,
      runtimeSelections,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
      field: 'generationOptions',
      details: {
        model: modelKey,
        selections: runtimeSelections,
        message,
      },
    })
  }

  const resolution = resolveBuiltinPricing({
    apiType: 'video',
    model: modelKey,
    selections: {
      ...resolvedOptions,
      ...(isSeedance2Model(modelKey) ? { containsVideoInput: false } : {}),
    },
  })
  if (resolution.status === 'missing_capability_match') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
      field: 'generationOptions',
      details: {
        model: modelKey,
        selections: resolvedOptions,
      },
    })
  }
}

type PanelReadinessInput = VideoReadinessPanelLike & {
  id: string
  storyboardId?: string | null
  panelIndex?: number | null
  storyboard?: (VideoReadinessPanelLike['storyboard'] & {
    episodeId?: string | null
  }) | null
}

type RoutedPanelPayload = {
  panel: PanelReadinessInput
  payload: Record<string, unknown>
  modelKey: string | null
  routing: Ltx23WorkflowRoutingResult | null
}

type LoadedReadinessVoiceLine = VideoReadinessVoiceLine & {
  lineIndex?: number | null
  matchedPanelId?: string | null
  matchedStoryboardId?: string | null
  matchedPanelIndex?: number | null
}

function mergeVoiceLinesById(
  ...lineGroups: Array<VideoReadinessVoiceLine[] | null | undefined>
): VideoReadinessVoiceLine[] {
  const seen = new Set<string>()
  const merged: VideoReadinessVoiceLine[] = []
  for (const lines of lineGroups) {
    for (const line of lines || []) {
      if (!line.id || seen.has(line.id)) continue
      seen.add(line.id)
      merged.push(line)
    }
  }
  return merged
}

function resolveSelectedVoiceLineIds(input: {
  payload?: unknown
  panel: PanelReadinessInput
}): string[] {
  const payloadBinding = isRecord(input.payload)
    ? parseVideoDurationBinding(input.payload.videoDurationBinding)
    : null
  const payloadVoiceLineIds = payloadBinding?.voiceLineIds || []
  if (payloadBinding?.mode === 'match_audio' && payloadVoiceLineIds.length > 0) {
    return payloadVoiceLineIds
  }

  const savedBinding = parseVideoDurationBinding(input.panel.videoDurationBinding)
  const savedVoiceLineIds = savedBinding.voiceLineIds || []
  if (savedBinding.mode === 'match_audio' && savedVoiceLineIds.length > 0) {
    return savedVoiceLineIds
  }
  return []
}

function sortLoadedVoiceLines(lines: LoadedReadinessVoiceLine[]): LoadedReadinessVoiceLine[] {
  return lines.slice().sort((left, right) => (left.lineIndex ?? 0) - (right.lineIndex ?? 0))
}

function stripLoadedVoiceLine(line: LoadedReadinessVoiceLine): VideoReadinessVoiceLine {
  return {
    id: line.id,
    content: line.content,
    audioDuration: line.audioDuration,
  }
}

function readRequestedDurationSeconds(payload: unknown): number | null {
  if (!isRecord(payload)) return null
  const options = payload.generationOptions
  if (!isRecord(options)) return null
  const duration = options.duration
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null
}

function readPositiveFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function resolveEffectiveVideoDurationBinding(input: {
  payload?: unknown
  panel: PanelReadinessInput
}) {
  const payloadBinding = isRecord(input.payload)
    ? parseVideoDurationBinding(input.payload.videoDurationBinding)
    : null
  const payloadVoiceLineIds = payloadBinding?.voiceLineIds || []
  if (payloadBinding?.mode === 'match_audio' && payloadVoiceLineIds.length > 0) {
    return payloadBinding
  }

  const savedBinding = parseVideoDurationBinding(input.panel.videoDurationBinding)
  const savedVoiceLineIds = savedBinding.voiceLineIds || []
  if (savedBinding.mode === 'match_audio' && savedVoiceLineIds.length > 0) {
    return savedBinding
  }

  return null
}

function resolveFirstLastFrameTargetDurationBinding(input: {
  payload?: unknown
  panel: PanelReadinessInput
}) {
  const payloadBinding = isRecord(input.payload)
    ? parseVideoDurationBinding(input.payload.videoDurationBinding)
    : null
  if (readPositiveFiniteNumber(payloadBinding?.targetDurationSeconds) !== null) {
    return payloadBinding
  }

  const savedBinding = parseVideoDurationBinding(input.panel.videoDurationBinding)
  if (readPositiveFiniteNumber(savedBinding.targetDurationSeconds) !== null) {
    return savedBinding
  }

  return null
}

function estimateSelectedAudioDurationSeconds(
  panel: PanelReadinessInput,
  payload: unknown,
): number | null {
  const selectedVoiceLineIds = resolveSelectedVoiceLineIds({ payload, panel })
  const matchedVoiceLines = panel.matchedVoiceLines || []
  const selectedSet = new Set(selectedVoiceLineIds)
  const voiceLinesForTiming = selectedVoiceLineIds.length > 0
    ? matchedVoiceLines.filter((line) => selectedSet.has(line.id))
    : matchedVoiceLines
  const totalMs = voiceLinesForTiming.reduce((sum, line) => {
      const duration = line.audioDuration
      return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? sum + duration
        : sum
  }, 0)
  return totalMs > 0 ? Number((totalMs / 1000).toFixed(2)) : null
}

function resolveAudioTargetDurationSeconds(input: {
  panel: PanelReadinessInput
  payload: Record<string, unknown>
  audioDurationSeconds: number | null
}): number | null {
  const binding = resolveEffectiveVideoDurationBinding(input)
  if (!binding || binding.mode !== 'match_audio') return null

  const currentTarget = readPositiveFiniteNumber(binding.targetDurationSeconds)
  if (currentTarget !== null && (
    input.audioDurationSeconds === null
    || currentTarget + 0.001 >= input.audioDurationSeconds
  )) {
    return Number(currentTarget.toFixed(2))
  }

  const requestedDuration = readRequestedDurationSeconds(input.payload)
  if (
    requestedDuration !== null
    && (
      input.audioDurationSeconds === null
      || requestedDuration + 0.001 >= input.audioDurationSeconds
    )
  ) {
    return Number(requestedDuration.toFixed(2))
  }

  return currentTarget !== null ? Number(currentTarget.toFixed(2)) : null
}

function resolveLtx23CapabilityDurationSeconds(route: Ltx23WorkflowRoutingResult): number {
  const durationSeconds = route.durationSeconds
  const durationOptions = route.profile.durationOptions
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)
  if (durationOptions.length === 0) return durationSeconds
  return durationOptions.find((value) => value + 0.001 >= durationSeconds)
    ?? durationOptions[durationOptions.length - 1]
}

function serializeLtx23WorkflowRouting(route: Ltx23WorkflowRoutingResult): Record<string, unknown> {
  return {
    selectedWorkflowKey: route.selectedWorkflowKey,
    selectedModelKey: route.selectedModelKey,
    category: route.profile.category,
    promptPolicy: route.profile.promptPolicy,
    selectionMode: route.selectionMode,
    routed: route.routed,
    confidence: route.confidence,
    reasons: route.reasons,
    durationSeconds: route.durationSeconds,
    capabilityDurationSeconds: resolveLtx23CapabilityDurationSeconds(route),
    fps: route.fps,
  }
}

function withLtx23WorkflowRoutingPayload(
  payload: Record<string, unknown>,
  route: Ltx23WorkflowRoutingResult | null,
  options?: {
    videoDurationBinding?: ReturnType<typeof resolveEffectiveVideoDurationBinding>
      | ReturnType<typeof resolveFirstLastFrameTargetDurationBinding>
  },
): Record<string, unknown> {
  if (!route) return payload

  const generationOptions = isRecord(payload.generationOptions)
    ? { ...payload.generationOptions }
    : {}
  generationOptions.duration = route.durationSeconds

  const next: Record<string, unknown> = {
    ...payload,
    generationOptions,
    ltx23WorkflowSelection: route.selectionMode,
    ltx23WorkflowRouting: serializeLtx23WorkflowRouting(route),
  }

  if (isRecord(payload.firstLastFrame)) {
    next.videoModel = route.selectedModelKey
    next.firstLastFrame = {
      ...payload.firstLastFrame,
      flModel: route.selectedModelKey,
    }
  } else {
    next.videoModel = route.selectedModelKey
  }

  const routedDurationBinding = options?.videoDurationBinding
  if (routedDurationBinding?.mode === 'match_audio' || (
    isRecord(payload.firstLastFrame)
    && readPositiveFiniteNumber(routedDurationBinding?.targetDurationSeconds) !== null
  )) {
    next.videoDurationBinding = {
      ...routedDurationBinding,
      targetDurationSeconds: Number(route.durationSeconds.toFixed(2)),
    }
  }

  return next
}

function resolvePanelLtx23RoutedPayload(
  payload: Record<string, unknown>,
  panel: PanelReadinessInput,
): RoutedPanelPayload {
  const modelKey = resolveVideoModelKeyFromPayload(payload)
  const customPrompt = readNonEmptyString(payload.customPrompt)
  const audioDurationSeconds = estimateSelectedAudioDurationSeconds(panel, payload)
  const audioTargetDurationSeconds = resolveAudioTargetDurationSeconds({
    panel,
    payload,
    audioDurationSeconds,
  })
  const generationMode = resolveVideoGenerationMode(payload)
  const videoDurationBinding = generationMode === 'firstlastframe'
    ? resolveFirstLastFrameTargetDurationBinding({ payload, panel })
    : resolveEffectiveVideoDurationBinding({ payload, panel })
  const bindingTargetDurationSeconds = generationMode === 'firstlastframe'
    ? readPositiveFiniteNumber(videoDurationBinding?.targetDurationSeconds)
    : null
  const requestedDurationSeconds = readRequestedDurationSeconds(payload)
  const firstLastRequestedDurationSeconds = bindingTargetDurationSeconds !== null
    ? normalizeLtx23GoonDurationSeconds(bindingTargetDurationSeconds)
    : requestedDurationSeconds
  const route = modelKey
    ? resolveLtx23WorkflowRoute({
        modelKey,
        selectionMode: payload.ltx23WorkflowSelection,
        generationMode,
        requestedDurationSeconds: generationMode === 'firstlastframe'
          ? firstLastRequestedDurationSeconds
          : requestedDurationSeconds,
        targetDurationSeconds: generationMode === 'firstlastframe'
          ? firstLastRequestedDurationSeconds
          : audioTargetDurationSeconds,
        audioDurationSeconds,
        panel: {
          videoPrompt: customPrompt || panel.videoPrompt,
          description: panel.description,
          shotType: panel.shotType,
          cameraMove: panel.cameraMove,
          sceneType: panel.sceneType,
          srtSegment: panel.srtSegment,
          clipContent: panel.storyboard?.clip?.content ?? null,
        },
      })
    : null
  const routedPayload = withLtx23WorkflowRoutingPayload(payload, route, {
    videoDurationBinding,
  })

  return {
    panel,
    payload: routedPayload,
    modelKey: route?.selectedModelKey ?? modelKey,
    routing: route,
  }
}

async function loadExplicitSelectedVoiceLines(
  panel: PanelReadinessInput,
  payload?: unknown,
): Promise<VideoReadinessVoiceLine[]> {
  const episodeId = panel.storyboard?.episodeId
  const selectedVoiceLineIds = resolveSelectedVoiceLineIds({ payload, panel })
  if (!episodeId || selectedVoiceLineIds.length === 0) return []

  return await prisma.novelPromotionVoiceLine.findMany({
    where: {
      id: { in: selectedVoiceLineIds },
      episodeId,
    },
    orderBy: { lineIndex: 'asc' },
    select: {
      id: true,
      content: true,
      audioDuration: true,
    },
  })
}

async function loadRelationVoiceLines(
  panel: PanelReadinessInput,
): Promise<VideoReadinessVoiceLine[]> {
  const episodeId = panel.storyboard?.episodeId
  if (!episodeId) return []

  return await prisma.novelPromotionVoiceLine.findMany({
    where: {
      episodeId,
      matchedPanelId: panel.id,
    },
    orderBy: { lineIndex: 'asc' },
    select: {
      id: true,
      content: true,
      audioDuration: true,
    },
  })
}

async function loadFallbackPanelVoiceLines(
  panel: PanelReadinessInput,
): Promise<VideoReadinessVoiceLine[]> {
  const episodeId = panel.storyboard?.episodeId
  if (
    !episodeId
    || !panel.storyboardId
    || typeof panel.panelIndex !== 'number'
  ) {
    return []
  }

  return await prisma.novelPromotionVoiceLine.findMany({
    where: {
      episodeId,
      matchedPanelId: null,
      matchedStoryboardId: panel.storyboardId,
      matchedPanelIndex: panel.panelIndex,
    },
    orderBy: { lineIndex: 'asc' },
    select: {
      id: true,
      content: true,
      audioDuration: true,
    },
  })
}

async function resolvePanelsReadinessInputs(
  panels: PanelReadinessInput[],
  payload?: unknown,
): Promise<PanelReadinessInput[]> {
  if (panels.length === 0) return []

  const panelIds = panels.map((panel) => panel.id).filter(Boolean)
  const episodeIds = Array.from(new Set(
    panels
      .map((panel) => panel.storyboard?.episodeId)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
  ))
  if (episodeIds.length === 0 || panelIds.length === 0) {
    return await Promise.all(panels.map((panel) => resolvePanelReadinessInput(panel, payload)))
  }

  const selectedIdsByPanelId = new Map<string, string[]>()
  const explicitSelectedIds = new Set<string>()
  for (const panel of panels) {
    const selectedIds = resolveSelectedVoiceLineIds({ payload, panel })
    selectedIdsByPanelId.set(panel.id, selectedIds)
    for (const id of selectedIds) explicitSelectedIds.add(id)
  }

  const fallbackPanelFilters = panels
    .filter((panel) => panel.storyboardId && typeof panel.panelIndex === 'number')
    .map((panel) => ({
      matchedStoryboardId: panel.storyboardId!,
      matchedPanelIndex: panel.panelIndex!,
    }))

  const [relationLines, fallbackLines, explicitLines] = await Promise.all([
    prisma.novelPromotionVoiceLine.findMany({
      where: {
        episodeId: { in: episodeIds },
        matchedPanelId: { in: panelIds },
      },
      orderBy: { lineIndex: 'asc' },
      select: {
        id: true,
        content: true,
        audioDuration: true,
        lineIndex: true,
        matchedPanelId: true,
      },
    }),
    fallbackPanelFilters.length > 0
      ? prisma.novelPromotionVoiceLine.findMany({
          where: {
            episodeId: { in: episodeIds },
            matchedPanelId: null,
            OR: fallbackPanelFilters,
          },
          orderBy: { lineIndex: 'asc' },
          select: {
            id: true,
            content: true,
            audioDuration: true,
            lineIndex: true,
            matchedStoryboardId: true,
            matchedPanelIndex: true,
          },
        })
      : Promise.resolve([] as LoadedReadinessVoiceLine[]),
    explicitSelectedIds.size > 0
      ? prisma.novelPromotionVoiceLine.findMany({
          where: {
            id: { in: Array.from(explicitSelectedIds) },
            episodeId: { in: episodeIds },
          },
          orderBy: { lineIndex: 'asc' },
          select: {
            id: true,
            content: true,
            audioDuration: true,
            lineIndex: true,
          },
        })
      : Promise.resolve([] as LoadedReadinessVoiceLine[]),
  ])

  const relationByPanelId = new Map<string, LoadedReadinessVoiceLine[]>()
  for (const line of relationLines) {
    if (!line.matchedPanelId) continue
    const lines = relationByPanelId.get(line.matchedPanelId) || []
    lines.push(line)
    relationByPanelId.set(line.matchedPanelId, lines)
  }

  const fallbackByPanelKey = new Map<string, LoadedReadinessVoiceLine[]>()
  for (const line of fallbackLines) {
    if (!line.matchedStoryboardId || typeof line.matchedPanelIndex !== 'number') continue
    const key = `${line.matchedStoryboardId}:${line.matchedPanelIndex}`
    const lines = fallbackByPanelKey.get(key) || []
    lines.push(line)
    fallbackByPanelKey.set(key, lines)
  }

  const explicitById = new Map(explicitLines.map((line) => [line.id, line]))

  return panels.map((panel) => {
    const selectedIds = selectedIdsByPanelId.get(panel.id) || []
    const explicitSelectedVoiceLines = selectedIds
      .map((id) => explicitById.get(id))
      .filter((line): line is LoadedReadinessVoiceLine => !!line)
      .map(stripLoadedVoiceLine)
    const fallbackKey = panel.storyboardId && typeof panel.panelIndex === 'number'
      ? `${panel.storyboardId}:${panel.panelIndex}`
      : ''

    return {
      ...panel,
      matchedVoiceLines: mergeVoiceLinesById(
        sortLoadedVoiceLines(relationByPanelId.get(panel.id) || []).map(stripLoadedVoiceLine),
        sortLoadedVoiceLines(fallbackByPanelKey.get(fallbackKey) || []).map(stripLoadedVoiceLine),
        explicitSelectedVoiceLines,
      ),
    }
  })
}

async function resolvePanelReadinessInput(
  panel: PanelReadinessInput,
  payload?: unknown,
): Promise<PanelReadinessInput> {
  const [relationVoiceLines, fallbackVoiceLines, explicitSelectedVoiceLines] = await Promise.all([
    loadRelationVoiceLines(panel),
    loadFallbackPanelVoiceLines(panel),
    loadExplicitSelectedVoiceLines(panel, payload),
  ])

  return {
    ...panel,
    matchedVoiceLines: mergeVoiceLinesById(
      relationVoiceLines,
      fallbackVoiceLines,
      explicitSelectedVoiceLines,
    ),
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = normalizeVideoPayloadModelKeys(await request.json())
  requireVideoModelKeyFromPayload(body)
  const locale = resolveRequiredTaskLocale(request, body)
  const isBatch = body?.all === true

  if (isBatch) {
    const episodeId = typeof body.episodeId === 'string' ? body.episodeId.trim() : ''
    if (!episodeId) {
      throw new ApiError('INVALID_PARAMS')
    }

    const panels = await prisma.novelPromotionPanel.findMany({
      where: {
        storyboard: { episodeId },
        OR: [
          { videoUrl: null },
          { videoUrl: '' },
        ],
      },
      select: {
        id: true,
        storyboardId: true,
        panelIndex: true,
        imageUrl: true,
        videoPrompt: true,
        videoPromptEditedByUser: true,
        description: true,
        srtSegment: true,
        videoDurationBinding: true,
        shotType: true,
        cameraMove: true,
        sceneType: true,
        storyboard: {
          select: {
            episodeId: true,
            clip: {
              select: {
                content: true,
              },
            },
          },
        },
      },
    })
    const panelsForReadiness = await resolvePanelsReadinessInputs(panels, body)
    const routedPanels = panelsForReadiness.map((panel) =>
      resolvePanelLtx23RoutedPayload(body, panel))
    const readiness = routedPanels.map((item) => {
      const capabilities = item.modelKey
        ? resolveBuiltinCapabilitiesByModelKey('video', item.modelKey)
        : undefined
      return {
        ...item,
        issue: resolvePanelVideoReadinessIssue(item.panel, {
          payload: item.payload,
          modelKey: item.modelKey,
          durationOptions: capabilities?.video?.durationOptions,
          fpsOptions: capabilities?.video?.fpsOptions,
        }),
      }
    })
    const readyPanels = readiness
      .filter((item) => item.issue === null)
      .map((item) => ({
        panel: item.panel,
        payload: item.payload,
      }))
    const skippedReasons = summarizeVideoReadinessIssues(readiness.map((item) => item.issue))

    if (readyPanels.length === 0) {
      return NextResponse.json({
        tasks: [],
        total: 0,
        skipped: panels.length,
        skippedReasons,
      })
    }

    const preparedSubmissions = await Promise.all(
      readyPanels.map(async ({ panel, payload }) => {
        validateFirstLastFrameModel(payload.firstLastFrame)
        await validateVideoCapabilityCombination({
          payload,
          projectId,
          userId: session.user.id,
        })
        return {
          panel,
          payload,
          hasOutputAtStart: await hasPanelVideoOutput(panel.id),
        }
      }),
    )

    const results = await Promise.all(
      preparedSubmissions.map(async ({ panel, payload, hasOutputAtStart }) => {
        return await submitTask({
          userId: session.user.id,
          locale,
          requestId: getRequestId(request),
          projectId,
          episodeId,
          type: TASK_TYPE.VIDEO_PANEL,
          targetType: 'NovelPromotionPanel',
          targetId: panel.id,
          payload: withTaskUiPayload(payload, {
            hasOutputAtStart,
          }),
          dedupeKey: `video_panel:${panel.id}`,
        })
      }),
    )

    return NextResponse.json({
      tasks: results,
      total: readyPanels.length,
      skipped: panels.length - readyPanels.length,
      skippedReasons,
    })
  }

  const storyboardId = body?.storyboardId
  const panelIndex = body?.panelIndex
  if (!storyboardId || panelIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  const panel = await prisma.novelPromotionPanel.findFirst({
    where: { storyboardId, panelIndex: Number(panelIndex) },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      imageUrl: true,
      videoPrompt: true,
      videoPromptEditedByUser: true,
      description: true,
      srtSegment: true,
      videoDurationBinding: true,
      shotType: true,
      cameraMove: true,
      sceneType: true,
      storyboard: {
        select: {
          episodeId: true,
          clip: {
            select: {
              content: true,
            },
          },
        },
      },
    },
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  const panelForReadiness = await resolvePanelReadinessInput(panel, body)
  const routedPanel = resolvePanelLtx23RoutedPayload(body, panelForReadiness)
  validateFirstLastFrameModel(routedPanel.payload.firstLastFrame)
  await validateVideoCapabilityCombination({
    payload: routedPanel.payload,
    projectId,
    userId: session.user.id,
  })
  const singleCapabilities = routedPanel.modelKey
    ? resolveBuiltinCapabilitiesByModelKey('video', routedPanel.modelKey)
    : undefined
  const readinessIssue = resolvePanelVideoReadinessIssue(routedPanel.panel, {
    payload: routedPanel.payload,
    modelKey: routedPanel.modelKey,
    durationOptions: singleCapabilities?.video?.durationOptions,
    fpsOptions: singleCapabilities?.video?.fpsOptions,
  })
  if (readinessIssue) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_READINESS_BLOCKED',
      field: 'videoDurationBinding',
      details: {
        issue: readinessIssue,
      },
    })
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: panel.storyboard.episodeId,
    type: TASK_TYPE.VIDEO_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload: withTaskUiPayload(routedPanel.payload, {
      hasOutputAtStart: await hasPanelVideoOutput(panel.id),
    }),
    dedupeKey: `video_panel:${panel.id}`,
  })

  return NextResponse.json(result)
})
