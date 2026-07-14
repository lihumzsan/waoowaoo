'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, isTaskTerminalEventType, type SSEEvent } from '@/lib/task/types'
import { normalizeSourceScriptSegments } from '@/lib/edit-bible/source-script-segments'
import type { EditSourceScriptStructure } from '@/lib/edit-bible/schemas'
import {
  appendStructuredJsonChunk,
  createStructuredStreamObjectParseState,
  createStructuredStreamParseState,
  type StructuredStreamParseState,
} from '@/lib/structured-stream/incremental-json'
import type {
  WorkspaceCanvasEditPipelineStepItem,
  WorkspaceCanvasStreamPresentation,
} from '../node-canvas-types'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  findStructuredStreamAdapters,
  type StructuredStreamAdapter,
  type StructuredStreamAdapterKey,
  type StructuredStreamItem,
  type StructuredStreamParsedItem,
} from './structured-stream-adapters'
import { workspaceNodeId } from '../workspace-canvas-node-ids'
import type {
  WorkspaceCanvasStreamKind,
  WorkspaceCanvasStreamPatch,
  WorkspaceCanvasStreamPatchData,
  WorkspaceCanvasStreamTarget,
} from './workspace-structured-stream-runtime-types'
import {
  areAllTerminalHandoffs,
  markTaskEntriesForTerminalHandoff,
  removeTargetTerminalHandoffs,
  removeTaskEntries,
} from './workspace-structured-stream-handoff'
import {
  addBoundedIdentity,
  createStructuredStreamAccumulatorKey,
  trimOldestMapEntries,
} from './workspace-structured-stream-identity'

type TranslateValues = Readonly<Record<string, string | number>>
type Translate = (key: string, values?: TranslateValues) => string

interface UseWorkspaceStructuredStreamRuntimeInput {
  readonly episodeId: string
  readonly translate: Translate
}

interface UseWorkspaceStructuredStreamRuntimeResult {
  readonly targets: readonly WorkspaceCanvasStreamTarget[]
  readonly patches: readonly WorkspaceCanvasStreamPatch[]
  readonly releaseTerminalHandoffs: (taskIds: readonly string[]) => void
}

export interface StreamAccumulator {
  readonly taskId: string
  readonly taskType: string | null
  readonly targetType: string | null
  readonly targetId: string | null
  readonly episodeId: string | null
  readonly stepId: string | null
  readonly stepAttempt: number
  readonly streamRunId: string
  readonly lane: string
  readonly adapter: StructuredStreamAdapter
  readonly parseState: StructuredStreamParseState
  readonly items: readonly StructuredStreamItem[]
  readonly errorMessage: string | null
  readonly lastSeq: number
  readonly terminalHandoff: boolean
}

export interface StructuredStreamSnapshot {
  readonly taskId: string
  readonly taskType: string | null
  readonly targetType: string | null
  readonly targetId: string | null
  readonly episodeId: string | null
  readonly adapterKey: StructuredStreamAdapterKey
  readonly items: readonly StructuredStreamItem[]
  readonly errorMessage: string | null
  readonly terminalHandoff?: boolean
}


function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

const MAX_STREAM_ACCUMULATORS = 128

function normalizeItems(
  adapter: StructuredStreamAdapter,
  previousItems: readonly StructuredStreamItem[],
  values: readonly unknown[],
): { readonly items: readonly StructuredStreamItem[]; readonly errorMessage: string | null } {
  if (values.length === 0) return { items: previousItems, errorMessage: null }
  const byKey = new Map(previousItems.map((item) => [item.itemKey, item]))
  const nextItems = [...previousItems]
  let errorMessage: string | null = null

  values.forEach((value) => {
    let parsed: StructuredStreamParsedItem
    try {
      parsed = adapter.parseItem(value)
    } catch (error) {
      errorMessage ??= error instanceof Error ? error.message : String(error)
      return
    }
    const fallbackIndex = nextItems.length
    const itemKey = adapter.itemKey(parsed, fallbackIndex)
    const item: StructuredStreamItem = {
      adapterKey: adapter.key,
      itemKey,
      value: parsed,
      index: fallbackIndex,
    }
    const existing = byKey.get(itemKey)
    if (existing) {
      const existingIndex = nextItems.findIndex((candidate) => candidate.itemKey === itemKey)
      if (existingIndex >= 0) nextItems[existingIndex] = item
    } else {
      byKey.set(itemKey, item)
      nextItems.push(item)
    }
  })

  return { items: nextItems, errorMessage }
}

export function processStructuredStreamEvent(
  current: ReadonlyMap<string, StreamAccumulator>,
  event: SSEEvent,
): ReadonlyMap<string, StreamAccumulator> {
  if (event.type !== TASK_SSE_EVENT_TYPE.STREAM) return current
  const payload = readRecord(event.payload)
  const stream = readRecord(payload.stream)
  const delta = readString(stream.delta)
  const kind = readString(stream.kind)
  if (!delta || kind !== 'text') return current

  const stepId = readString(payload.stepId)
  const stepAttempt = readPositiveInteger(payload.stepAttempt)
  const streamRunId = readString(payload.streamRunId)
  const lane = readString(stream.lane) ?? 'main'
  const seq = readPositiveInteger(stream.seq)
  if (!streamRunId || !stepAttempt || !seq) return current
  const adapters = findStructuredStreamAdapters({
    taskType: event.taskType ?? null,
    stepId,
  })
  if (adapters.length === 0) return current

  const next = new Map(removeTargetTerminalHandoffs(
    current,
    event.targetType ?? null,
    event.targetId ?? null,
  ))
  adapters.forEach((adapter) => {
    const key = createStructuredStreamAccumulatorKey({
      taskId: event.taskId,
      streamRunId,
      stepAttempt,
      stepId,
      lane,
      adapterKey: adapter.key,
    })
    const previous = next.get(key)
    const logicalAccumulators = [...next.entries()].filter(([, accumulator]) => (
      accumulator.taskId === event.taskId
      && accumulator.stepId === stepId
      && accumulator.lane === lane
      && accumulator.adapter.key === adapter.key
    ))
    const highestAttempt = logicalAccumulators.reduce(
      (highest, [, accumulator]) => Math.max(highest, accumulator.stepAttempt),
      0,
    )
    if (stepAttempt < highestAttempt) return
    if (stepAttempt > highestAttempt) {
      logicalAccumulators.forEach(([accumulatorKey]) => next.delete(accumulatorKey))
    }
    if (previous && seq <= previous.lastSeq) return
    if (previous && seq !== previous.lastSeq + 1) return
    if (!previous && seq !== 1) return
    const parseState = previous?.parseState ?? (
      adapter.mode === 'object'
        ? createStructuredStreamObjectParseState(adapter.path)
        : createStructuredStreamParseState(adapter.path)
    )
    try {
      const result = appendStructuredJsonChunk(parseState, delta)
      const normalized = normalizeItems(adapter, previous?.items ?? [], result.items)
      next.set(key, {
        taskId: event.taskId,
        taskType: event.taskType ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        episodeId: event.episodeId ?? null,
        stepId,
        stepAttempt,
        streamRunId,
        lane,
        adapter,
        parseState: result.state,
        items: normalized.items,
        errorMessage: normalized.errorMessage ?? previous?.errorMessage ?? null,
        lastSeq: seq,
        terminalHandoff: false,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      next.set(key, {
        taskId: event.taskId,
        taskType: event.taskType ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        episodeId: event.episodeId ?? null,
        stepId,
        stepAttempt,
        streamRunId,
        lane,
        adapter,
        parseState,
        items: previous?.items ?? [],
        errorMessage: message,
        lastSeq: seq,
        terminalHandoff: false,
      })
    }
  })

  trimOldestMapEntries(next, MAX_STREAM_ACCUMULATORS)

  return next
}

export function snapshotsFromAccumulators(
  accumulators: ReadonlyMap<string, StreamAccumulator>,
): readonly StructuredStreamSnapshot[] {
  return [...accumulators.values()]
    .filter((accumulator) => accumulator.items.length > 0)
    .map((accumulator) => ({
      taskId: accumulator.taskId,
      taskType: accumulator.taskType,
      targetType: accumulator.targetType,
      targetId: accumulator.targetId,
      episodeId: accumulator.episodeId,
      adapterKey: accumulator.adapter.key,
      items: accumulator.items,
      errorMessage: accumulator.errorMessage,
      terminalHandoff: accumulator.terminalHandoff,
    }))
}

export function shouldClearStreamAccumulatorsForLifecycle(
  lifecycleType: string | null,
  payload: Record<string, unknown>,
): boolean {
  return lifecycleType === TASK_EVENT_TYPE.CREATED && readString(payload.reason) === 'watchdog_requeue'
}

export function isTerminalStructuredStreamLifecycle(lifecycleType: string | null): boolean {
  return isTaskTerminalEventType(lifecycleType)
}

function streamPresentation(items: readonly StructuredStreamItem[]): WorkspaceCanvasStreamPresentation {
  const activeItemKey = items.at(-1)?.itemKey ?? null
  return {
    isStreaming: true,
    activeItemKey,
    displayedItemKeys: items.map((item) => item.itemKey),
    pinnedItemKeys: [],
    revealedFieldCountByKey: Object.fromEntries(items.map((item) => [item.itemKey, Number.MAX_SAFE_INTEGER])),
  }
}

function itemsOfKind<K extends StructuredStreamParsedItem['kind']>(
  snapshots: readonly StructuredStreamSnapshot[],
  adapterKey: StructuredStreamAdapterKey,
  kind: K,
): Array<Extract<StructuredStreamParsedItem, { readonly kind: K }>> {
  return snapshots
    .filter((snapshot) => snapshot.adapterKey === adapterKey)
    .flatMap((snapshot) => snapshot.items)
    .flatMap((item) => (item.value.kind === kind ? [item.value as Extract<StructuredStreamParsedItem, { readonly kind: K }>] : []))
}

function pipelineItemsFromShotExecutionPlan(
  items: Array<Extract<StructuredStreamParsedItem, { readonly kind: 'shotExecutionPlanShot' }>>,
  translate: Translate,
): WorkspaceCanvasEditPipelineStepItem[] {
  return items.map(({ shot }, index) => ({
    title: translate('nodeFields.shotIndex', { index: index + 1 }),
    fields: [
      { label: translate('nodeFields.shotScale'), value: shot.shotScale },
      { label: translate('nodeFields.movement'), value: shot.cameraMovement.movement },
      { label: translate('nodeFields.cameraStability'), value: shot.cameraMovement.stability },
    ],
  }))
}

interface WorkspaceCanvasStreamRuntimeEntry {
  readonly target: WorkspaceCanvasStreamTarget
  readonly patch: WorkspaceCanvasStreamPatch
}

function createStreamRuntimeEntry(input: {
  readonly nodeId: string
  readonly streamKind: WorkspaceCanvasStreamKind
  readonly taskId: string
  readonly taskType: string | null
  readonly targetType: string | null
  readonly targetId: string
  readonly episodeId: string | null
  readonly terminalHandoff: boolean
  readonly presentation: WorkspaceCanvasStreamPresentation
  readonly data: WorkspaceCanvasStreamPatchData
}): WorkspaceCanvasStreamRuntimeEntry {
  return {
    target: {
      nodeId: input.nodeId,
      streamKind: input.streamKind,
      taskId: input.taskId,
      taskType: input.taskType,
      targetType: input.targetType,
      targetId: input.targetId,
      episodeId: input.episodeId,
    },
    patch: {
      nodeId: input.nodeId,
      streamKind: input.streamKind,
      taskId: input.taskId,
      taskType: input.taskType,
      terminalHandoff: input.terminalHandoff,
      presentation: input.terminalHandoff ? { ...input.presentation, isStreaming: false } : input.presentation,
      data: input.data,
    },
  }
}

function firstItemOfKind<K extends StructuredStreamParsedItem['kind']>(
  snapshots: readonly StructuredStreamSnapshot[],
  adapterKey: StructuredStreamAdapterKey,
  kind: K,
): Extract<StructuredStreamParsedItem, { readonly kind: K }> | null {
  return itemsOfKind(snapshots, adapterKey, kind).at(-1) ?? null
}

function productionPlanningBody(input: {
  readonly bible: Extract<StructuredStreamParsedItem, { readonly kind: 'productionPlanningGlobalBible' }> | null
  readonly beatCount: number
  readonly eventCount: number
  readonly cueCount: number
  readonly translate: Translate
}): string {
  const bible = input.bible?.bible ?? null
  if (bible?.synopsis?.trim()) return bible.synopsis.trim()
  if (bible?.logline?.trim()) return bible.logline.trim()
  if (bible?.title?.trim()) return bible.title.trim()
  if (input.beatCount > 0) return input.translate('nodes.editBible.pendingBody')
  if (input.eventCount > 0) return input.translate('nodes.editBible.pendingBody')
  if (input.cueCount > 0) return input.translate('nodes.editBible.pendingBody')
  return input.translate('nodes.editBible.pendingBody')
}

function buildSourceScriptRuntimeEntries(
  snapshots: readonly StructuredStreamSnapshot[],
  translate: Translate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  const matchingSnapshots = snapshots.filter((snapshot) => snapshot.adapterKey === 'sourceScript.segments')
  const grouped = new Map<string, StructuredStreamSnapshot[]>()
  matchingSnapshots.forEach((snapshot) => {
    if (snapshot.targetType !== 'ProjectEditSourceScript' || !snapshot.targetId) return
    const key = `${snapshot.taskId}:${snapshot.episodeId ?? snapshot.targetId}:${snapshot.targetId}`
    grouped.set(key, [...(grouped.get(key) ?? []), snapshot])
  })
  return [...grouped.values()].flatMap((group) => {
    const firstSnapshot = group[0] ?? null
    if (!firstSnapshot?.targetId) return []
    const segmentItems = itemsOfKind(group, 'sourceScript.segments', 'sourceScriptSceneSegment')
    const firstSegment = segmentItems[0]?.segment ?? null
    let structure: EditSourceScriptStructure | null = null
    let sourceText = ''
    if (firstSegment) {
      try {
        const normalized = normalizeSourceScriptSegments({
          title: firstSegment.episodeTitle,
          summary: firstSegment.episodeSummary,
          segments: segmentItems.map((item) => item.segment),
        })
        structure = normalized.structure
        sourceText = normalized.normalizedText
      } catch {}
    }
    if (!structure) return []
    const rawItems = group.flatMap((snapshot) => snapshot.items)
    const nodeId = workspaceNodeId.editSourceScript(firstSnapshot.episodeId ?? firstSnapshot.targetId)
    return [createStreamRuntimeEntry({
      nodeId,
      streamKind: 'editSourceScript',
      taskId: firstSnapshot.taskId,
      taskType: firstSnapshot.taskType,
      targetType: firstSnapshot.targetType,
      targetId: firstSnapshot.targetId,
      episodeId: firstSnapshot.episodeId,
      terminalHandoff: areAllTerminalHandoffs(group),
      presentation: streamPresentation(rawItems),
      data: {
        body: structure.summary ?? translate('nodes.editSourceScript.pendingBody'),
        meta: translate('nodes.editSourceScript.pendingMeta'),
        sourceScriptDetails: {
          sourceText,
          scriptStructure: structure,
        },
      },
    })]
  })
}

function buildProductionPlanningRuntimeEntries(
  snapshots: readonly StructuredStreamSnapshot[],
  translate: Translate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  const matchingSnapshots = snapshots.filter((snapshot) => snapshot.adapterKey.startsWith('productionPlanning.'))
  const grouped = new Map<string, StructuredStreamSnapshot[]>()
  matchingSnapshots.forEach((snapshot) => {
    if (snapshot.targetType !== 'ProjectEditBible' || !snapshot.targetId) return
    const key = `${snapshot.taskId}:${snapshot.episodeId ?? snapshot.targetId}:${snapshot.targetId}`
    grouped.set(key, [...(grouped.get(key) ?? []), snapshot])
  })
  return [...grouped.values()].flatMap((group) => {
    const firstSnapshot = group[0] ?? null
    if (!firstSnapshot?.targetId) return []
    const globalBible = firstItemOfKind(group, 'productionPlanning.globalBible', 'productionPlanningGlobalBible')
    const beatItems = itemsOfKind(group, 'productionPlanning.beats', 'productionPlanningBeat')
    const ledgerItems = itemsOfKind(group, 'productionPlanning.ledgerEvents', 'productionPlanningLedgerEvent')
    const emotionalCueItems = itemsOfKind(group, 'productionPlanning.emotionalCues', 'productionPlanningEmotionalCue')
    if (!globalBible && beatItems.length === 0 && ledgerItems.length === 0 && emotionalCueItems.length === 0) return []
    const rawItems = group.flatMap((snapshot) => snapshot.items)
    const nodeId = workspaceNodeId.editBible(firstSnapshot.episodeId ?? firstSnapshot.targetId)
    const body = productionPlanningBody({
      bible: globalBible,
      beatCount: beatItems.length,
      eventCount: ledgerItems.length,
      cueCount: emotionalCueItems.length,
      translate,
    })
    return [createStreamRuntimeEntry({
      nodeId,
      streamKind: 'editBible',
      taskId: firstSnapshot.taskId,
      taskType: firstSnapshot.taskType,
      targetType: firstSnapshot.targetType,
      targetId: firstSnapshot.targetId,
      episodeId: firstSnapshot.episodeId,
      terminalHandoff: areAllTerminalHandoffs(group),
      presentation: streamPresentation(rawItems),
      data: {
        body,
        meta: translate('nodes.editBible.pendingMeta'),
        editBibleDetails: {
          bibleText: body,
          bible: globalBible?.bible ?? null,
          beatSheet: beatItems.length > 0 ? { beats: beatItems.map((item) => item.beat) } : null,
          ledger: ledgerItems.length > 0 ? { events: ledgerItems.map((item) => item.event) } : null,
          emotionalCurve: emotionalCueItems.length > 0 ? { cues: emotionalCueItems.map((item) => item.cue) } : null,
          chapters: [],
        },
      },
    })]
  })
}

function buildEditScriptRuntimeEntries(
  snapshots: readonly StructuredStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  const editScriptSnapshots = snapshots.filter((snapshot) => snapshot.adapterKey === 'editScript.shots')
  const taskTargets = Array.from(new Set(editScriptSnapshots.flatMap((snapshot) => (
    snapshot.targetId ? [`${snapshot.taskId}:${snapshot.targetId}`] : []
  ))))
  return taskTargets.flatMap((taskTarget) => {
    const separator = taskTarget.indexOf(':')
    const taskId = taskTarget.slice(0, separator)
    const targetId = taskTarget.slice(separator + 1)
    const scopedSnapshots = editScriptSnapshots.filter((snapshot) => (
      snapshot.taskId === taskId && snapshot.targetId === targetId
    ))
    const shotItems = itemsOfKind(scopedSnapshots, 'editScript.shots', 'editScriptShot')
    if (shotItems.length === 0) return []
    const firstSnapshot = scopedSnapshots[0] ?? null
    if (!firstSnapshot) return []
    const durationSec = shotItems.reduce((total, item) => total + item.shot.durationSec, 0)
    const rawItems = scopedSnapshots.flatMap((snapshot) => snapshot.items)
    const nodeId = workspaceNodeId.editScript(firstSnapshot.episodeId ?? episodeId, targetId)
    return [createStreamRuntimeEntry({
      nodeId,
      streamKind: 'editScript',
      taskId: firstSnapshot.taskId,
      taskType: firstSnapshot.taskType,
      targetType: firstSnapshot.targetType,
      targetId,
      episodeId: firstSnapshot.episodeId ?? episodeId,
      terminalHandoff: areAllTerminalHandoffs(scopedSnapshots),
      presentation: streamPresentation(rawItems),
      data: {
        body: translate('nodes.editScript.pendingBody'),
        meta: translate('nodes.editScript.meta', {
          shots: shotItems.length,
          duration: durationSec,
          assets: 0,
          completed: 0,
        }),
        editScriptDetails: shotItems.length > 0 ? {
          durationSec,
          shotCount: shotItems.length,
          shots: shotItems
            .map(({ shot }) => ({
              shotId: shot.shotRef,
              shotNumber: shot.shotNumber,
              durationSec: shot.durationSec,
              sceneName: shot.scene.locationName,
              action: shot.action,
              characters: shot.characters.map((character) => `${character.characterName} / ${character.performance}`),
              dialogue: shot.dialogue.map((line) => `${line.speakerName}: ${line.line}`),
              synchronousSound: shot.synchronousSound,
            })),
        } : undefined,
      },
    })]
  })
}

function buildShotExecutionRuntimeEntry(
  snapshots: readonly StructuredStreamSnapshot[],
  translate: Translate,
): WorkspaceCanvasStreamRuntimeEntry | null {
  const matchingSnapshots = snapshots.filter((snapshot) => snapshot.adapterKey === 'shotExecutionPlan.shots')
  const shotItems = itemsOfKind(matchingSnapshots, 'shotExecutionPlan.shots', 'shotExecutionPlanShot')
  if (shotItems.length === 0) return null
  const rawItems = matchingSnapshots.flatMap((snapshot) => snapshot.items)
  const firstSnapshot = matchingSnapshots[0] ?? null
  if (!firstSnapshot) return null
  const editScriptId = firstSnapshot.targetId
  if (!editScriptId) return null
  const nodeId = workspaceNodeId.editShotExecutionPlan(editScriptId)
  return createStreamRuntimeEntry({
    nodeId,
    streamKind: 'editShotExecutionPlan',
    taskId: firstSnapshot.taskId,
    taskType: firstSnapshot.taskType,
    targetType: firstSnapshot.targetType,
    targetId: editScriptId,
    episodeId: firstSnapshot.episodeId,
    terminalHandoff: areAllTerminalHandoffs(matchingSnapshots),
    presentation: streamPresentation(rawItems),
    data: {
      body: translate('nodes.editShotExecutionPlan.pendingBody'),
      meta: translate('nodes.editShotExecutionPlan.meta', { shots: shotItems.length }),
      editPipelineStepDetails: shotItems.length > 0 ? {
        items: pipelineItemsFromShotExecutionPlan(shotItems, translate),
      } : undefined,
    },
  })
}

function buildBgmRuntimeEntry(
  snapshots: readonly StructuredStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): WorkspaceCanvasStreamRuntimeEntry | null {
  const cues = itemsOfKind(snapshots, 'audioDesign.scoreCues', 'audioDesignScoreCue').map((item) => item.cue)
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey === 'audioDesign.scoreCues')
    .flatMap((snapshot) => snapshot.items)
  if (cues.length === 0) return null
  const firstSnapshot = snapshots.find((snapshot) => snapshot.adapterKey === 'audioDesign.scoreCues') ?? null
  if (!firstSnapshot) return null
  const nodeId = workspaceNodeId.bgmScore(episodeId)
  return createStreamRuntimeEntry({
    nodeId,
    streamKind: 'bgmScore',
    taskId: firstSnapshot.taskId,
    taskType: firstSnapshot.taskType,
    targetType: firstSnapshot.targetType,
    targetId: episodeId,
    episodeId: firstSnapshot.episodeId ?? episodeId,
    terminalHandoff: areAllTerminalHandoffs(
      snapshots.filter((snapshot) => snapshot.adapterKey === 'audioDesign.scoreCues'),
    ),
    presentation: streamPresentation(rawItems),
    data: {
      body: translate('nodes.bgmScore.body', { videos: 0 }),
      meta: translate('nodes.bgmScore.ready', { count: cues.length }),
      bgmScoreDetails: {
        status: 'generating',
        durationSeconds: null,
        musicModel: null,
        hasPromptDesign: rawItems.length > 0,
        promptDesignMissing: false,
        designSectionCount: cues[0]?.musicTheorySpec.phases.length ?? 0,
        promptSectionCount: 0,
        virtualLayerCount: cues[0]?.musicTheorySpec.orchestration.length ?? 0,
        mixUrl: null,
        errorMessage: null,
        scoreOverview: cues[0]?.narrativeDiagnosis.musicShouldDo ?? null,
        designSections: (cues[0]?.musicTheorySpec.phases ?? []).map((phase) => ({
          category: phase.function,
          title: phase.phaseId,
          purpose: `${phase.density} / ${phase.spectralBand}`,
          startSec: phase.range.startFrame / 24,
          endSec: phase.range.endFrameExclusive / 24,
          content: `${Math.round(phase.energy * 100)}% energy`,
        })),
        promptSections: [],
        virtualLayers: (cues[0]?.musicTheorySpec.orchestration ?? []).map((part) => ({
          name: part.instrument,
          purpose: `${part.role} / ${part.register}`,
          content: part.techniques.join(', '),
        })),
        finalPrompt: null,
      },
    },
  })
}

function buildAmbientSoundRuntimeEntry(
  snapshots: readonly StructuredStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): WorkspaceCanvasStreamRuntimeEntry | null {
  const sources = itemsOfKind(snapshots, 'audioDesign.ambienceSources', 'audioDesignAmbienceSource').map((item) => item.source)
  const worlds = itemsOfKind(snapshots, 'audioDesign.soundWorlds', 'audioDesignSoundWorld').map((item) => item.world)
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey === 'audioDesign.ambienceSources' || snapshot.adapterKey === 'audioDesign.soundWorlds')
    .flatMap((snapshot) => snapshot.items)
  if (sources.length === 0 && worlds.length === 0) return null
  const firstSnapshot = snapshots.find((snapshot) => snapshot.adapterKey === 'audioDesign.ambienceSources' || snapshot.adapterKey === 'audioDesign.soundWorlds') ?? null
  if (!firstSnapshot) return null
  const nodeId = workspaceNodeId.ambientSound(episodeId)
  return createStreamRuntimeEntry({
    nodeId,
    streamKind: 'ambientSound',
    taskId: firstSnapshot.taskId,
    taskType: firstSnapshot.taskType,
    targetType: firstSnapshot.targetType,
    targetId: episodeId,
    episodeId: firstSnapshot.episodeId ?? episodeId,
    terminalHandoff: areAllTerminalHandoffs(
      snapshots.filter((snapshot) => snapshot.adapterKey === 'audioDesign.ambienceSources' || snapshot.adapterKey === 'audioDesign.soundWorlds'),
    ),
    presentation: streamPresentation(rawItems),
    data: {
      body: translate('nodes.ambientSound.body', { videos: 0 }),
      meta: translate('nodes.ambientSound.ready', { sources: sources.length, sections: worlds.length }),
      ambientSoundDetails: {
        status: 'planning',
        decision: null,
        soundEffectModel: null,
        sourceCount: sources.length,
        sectionCount: worlds.length,
        sources: sources.map((source, index) => ({
          key: source.sourceId,
          sourceIndex: index + 1,
          prompt: source.generationPrompt,
          loopDurationSeconds: source.loopDurationSeconds,
          promptInfluence: source.promptInfluence,
        })),
        sections: [],
        mixUrl: null,
        errorMessage: null,
      },
    },
  })
}

export function buildStreamRuntimeEntries(
  snapshots: readonly StructuredStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  return [
    ...buildSourceScriptRuntimeEntries(snapshots, translate),
    ...buildProductionPlanningRuntimeEntries(snapshots, translate),
    ...buildEditScriptRuntimeEntries(snapshots, episodeId, translate),
    buildShotExecutionRuntimeEntry(snapshots, translate),
    buildBgmRuntimeEntry(snapshots, episodeId, translate),
    buildAmbientSoundRuntimeEntry(snapshots, episodeId, translate),
  ].filter((entry): entry is WorkspaceCanvasStreamRuntimeEntry => entry !== null)
}

export function useWorkspaceStructuredStreamRuntime({
  episodeId,
  translate,
}: UseWorkspaceStructuredStreamRuntimeInput): UseWorkspaceStructuredStreamRuntimeResult {
  const { subscribeTaskEvents } = useWorkspaceProvider()
  const [accumulators, setAccumulators] = useState<ReadonlyMap<string, StreamAccumulator>>(() => new Map())
  const terminalStreamRunIdsRef = useRef<ReadonlySet<string>>(new Set())
  const streamRunIdsByTaskRef = useRef<ReadonlyMap<string, readonly string[]>>(new Map())

  useEffect(() => {
    return subscribeTaskEvents((event) => {
      if ('episodeId' in event && event.episodeId && event.episodeId !== episodeId) return
      if (event.type === TASK_SSE_EVENT_TYPE.STREAM) {
        const payload = readRecord(event.payload)
        const streamRunId = readString(payload.streamRunId)
        if (!streamRunId || terminalStreamRunIdsRef.current.has(streamRunId)) return
        const runsByTask = new Map(streamRunIdsByTaskRef.current)
        const taskRuns = [...(runsByTask.get(event.taskId) ?? [])].filter((value) => value !== streamRunId)
        taskRuns.push(streamRunId)
        runsByTask.set(event.taskId, taskRuns.slice(-8))
        trimOldestMapEntries(runsByTask, 128)
        streamRunIdsByTaskRef.current = runsByTask
        setAccumulators((current) => processStructuredStreamEvent(current, event))
        return
      }
      if (event.type !== TASK_SSE_EVENT_TYPE.LIFECYCLE) return
      const payload = readRecord(event.payload)
      const lifecycleType = readString(payload.lifecycleType)
      if (shouldClearStreamAccumulatorsForLifecycle(lifecycleType, payload)) {
        setAccumulators((current) => removeTaskEntries(current, event.taskId))
        return
      }
      if (!isTerminalStructuredStreamLifecycle(lifecycleType)) return
      for (const streamRunId of streamRunIdsByTaskRef.current.get(event.taskId) ?? []) {
        terminalStreamRunIdsRef.current = addBoundedIdentity(
          terminalStreamRunIdsRef.current,
          streamRunId,
        )
      }
      const runsByTask = new Map(streamRunIdsByTaskRef.current)
      runsByTask.delete(event.taskId)
      streamRunIdsByTaskRef.current = runsByTask
      setAccumulators((current) => (
        lifecycleType === TASK_EVENT_TYPE.COMPLETED
          ? markTaskEntriesForTerminalHandoff(current, event.taskId)
          : removeTaskEntries(current, event.taskId)
      ))
    })
  }, [episodeId, subscribeTaskEvents])

  const releaseTerminalHandoffs = useCallback((taskIds: readonly string[]) => {
    const identities = new Set(taskIds.filter((taskId) => taskId.trim().length > 0))
    setAccumulators((current) => removeTaskEntries(current, identities))
  }, [])

  const entries = useMemo(
    () => buildStreamRuntimeEntries(
      snapshotsFromAccumulators(accumulators),
      episodeId,
      translate,
    ),
    [accumulators, episodeId, translate],
  )

  return useMemo(() => ({
    targets: entries.map((entry) => entry.target),
    patches: entries.map((entry) => entry.patch),
    releaseTerminalHandoffs,
  }), [entries, releaseTerminalHandoffs])
}
