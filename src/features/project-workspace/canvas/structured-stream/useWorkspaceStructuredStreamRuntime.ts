'use client'

import { useEffect, useMemo, useState } from 'react'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, type SSEEvent } from '@/lib/task/types'
import {
  appendStructuredJsonChunk,
  createStructuredStreamObjectParseState,
  createStructuredStreamParseState,
  type StructuredStreamParseState,
} from '@/lib/structured-stream/incremental-json'
import type {
  WorkspaceCanvasEditPipelineStepItem,
  WorkspaceCanvasFlowNode,
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

type TranslateValues = Readonly<Record<string, string | number>>
type Translate = (key: string, values?: TranslateValues) => string

interface UseWorkspaceStructuredStreamRuntimeInput {
  readonly episodeId: string
  readonly translate: Translate
}

interface UseWorkspaceStructuredStreamRuntimeResult {
  readonly targets: readonly WorkspaceCanvasStreamTarget[]
  readonly patches: readonly WorkspaceCanvasStreamPatch[]
}

interface StreamAccumulator {
  readonly taskId: string
  readonly taskType: string | null
  readonly targetType: string | null
  readonly targetId: string | null
  readonly episodeId: string | null
  readonly stepId: string | null
  readonly streamRunId: string
  readonly lane: string
  readonly adapter: StructuredStreamAdapter
  readonly parseState: StructuredStreamParseState
  readonly items: readonly StructuredStreamItem[]
  readonly errorMessage: string | null
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
}


function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function createAccumulatorKey(input: {
  readonly taskId: string
  readonly streamRunId: string
  readonly stepId: string | null
  readonly lane: string
  readonly adapterKey: StructuredStreamAdapterKey
}): string {
  return [
    input.taskId,
    input.streamRunId,
    input.stepId ?? '__step',
    input.lane,
    input.adapterKey,
  ].join('|')
}

function normalizeItems(
  adapter: StructuredStreamAdapter,
  previousItems: readonly StructuredStreamItem[],
  values: readonly unknown[],
): readonly StructuredStreamItem[] {
  if (values.length === 0) return previousItems
  const byKey = new Map(previousItems.map((item) => [item.itemKey, item]))
  const nextItems = [...previousItems]

  values.forEach((value) => {
    const parsed = adapter.parseItem(value)
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

  return nextItems
}

function processStreamEvent(
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
  const streamRunId = readString(payload.streamRunId) ?? `run:${event.taskId}`
  const lane = readString(stream.lane) ?? 'main'
  const adapters = findStructuredStreamAdapters({
    taskType: event.taskType ?? null,
    stepId,
  })
  if (adapters.length === 0) return current

  const next = new Map(current)
  adapters.forEach((adapter) => {
    const key = createAccumulatorKey({
      taskId: event.taskId,
      streamRunId,
      stepId,
      lane,
      adapterKey: adapter.key,
    })
    const previous = next.get(key)
    if (previous?.errorMessage) return
    const parseState = previous?.parseState ?? (
      adapter.mode === 'object'
        ? createStructuredStreamObjectParseState(adapter.path)
        : createStructuredStreamParseState(adapter.path)
    )
    try {
      const result = appendStructuredJsonChunk(parseState, delta)
      next.set(key, {
        taskId: event.taskId,
        taskType: event.taskType ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        episodeId: event.episodeId ?? null,
        stepId,
        streamRunId,
        lane,
        adapter,
        parseState: result.state,
        items: normalizeItems(adapter, previous?.items ?? [], result.items),
        errorMessage: null,
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
        streamRunId,
        lane,
        adapter,
        parseState,
        items: previous?.items ?? [],
        errorMessage: message,
      })
    }
  })

  return next
}

function snapshotsFromAccumulators(
  accumulators: ReadonlyMap<string, StreamAccumulator>,
): readonly StructuredStreamSnapshot[] {
  return [...accumulators.values()]
    .filter((accumulator) => accumulator.items.length > 0 || accumulator.errorMessage)
    .map((accumulator) => ({
      taskId: accumulator.taskId,
      taskType: accumulator.taskType,
      targetType: accumulator.targetType,
      targetId: accumulator.targetId,
      episodeId: accumulator.episodeId,
      adapterKey: accumulator.adapter.key,
      items: accumulator.items,
      errorMessage: accumulator.errorMessage,
    }))
}

function removeAccumulatorsForTask<T extends { readonly taskId: string }>(
  current: ReadonlyMap<string, T>,
  taskId: string,
): ReadonlyMap<string, T> {
  const next = new Map(current)
  next.forEach((accumulator, key) => {
    if (accumulator.taskId === taskId) next.delete(key)
  })
  return next
}

export function shouldClearStreamAccumulatorsForLifecycle(
  lifecycleType: string | null,
  payload: Record<string, unknown>,
): boolean {
  return lifecycleType === TASK_EVENT_TYPE.CREATED && readString(payload.reason) === 'watchdog_requeue'
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
  return items.map(({ shot }) => ({
    title: translate('nodeFields.shotIndex', { index: shot.shotNumber }),
    fields: [
      { label: translate('nodeFields.shotScale'), value: shot.camera.shotScale },
      { label: translate('nodeFields.lens'), value: shot.camera.lens },
      { label: translate('nodeFields.focus'), value: shot.camera.focus },
      { label: translate('nodeFields.cameraHeight'), value: shot.camera.height },
      { label: translate('nodeFields.cameraAngle'), value: shot.camera.angle },
      { label: translate('nodeFields.movement'), value: shot.camera.movement },
      { label: translate('nodeFields.lighting'), value: shot.camera.lighting },
      { label: translate('nodeFields.axisAndEyeline'), value: shot.blocking.axis.screenDirection },
    ],
    body: shot.blocking.spatialNote,
    chips: [
      String(shot.shotNumber),
      ...shot.blocking.characters.map((character) => `${character.name}/${character.visibility}`),
      ...shot.blocking.objects.map((object) => object.name),
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
  const matchingSnapshots = snapshots.filter((snapshot) => (
    snapshot.adapterKey === 'sourceScript.structure'
    || snapshot.adapterKey === 'sourceScript.episodes'
  ))
  const grouped = new Map<string, StructuredStreamSnapshot[]>()
  matchingSnapshots.forEach((snapshot) => {
    if (snapshot.targetType !== 'ProjectEditSourceScript' || !snapshot.targetId) return
    const key = `${snapshot.episodeId ?? snapshot.targetId}:${snapshot.targetId}`
    grouped.set(key, [...(grouped.get(key) ?? []), snapshot])
  })
  return [...grouped.values()].flatMap((group) => {
    const firstSnapshot = group[0] ?? null
    if (!firstSnapshot?.targetId) return []
    const completeStructure = firstItemOfKind(group, 'sourceScript.structure', 'sourceScriptStructure')?.structure ?? null
    const episodeItems = itemsOfKind(group, 'sourceScript.episodes', 'sourceScriptEpisode')
    const structure = completeStructure ?? (episodeItems.length > 0
      ? {
          version: 1 as const,
          title: episodeItems[0]?.episode.title ?? translate('nodes.editSourceScript.pendingTitle'),
          summary: episodeItems[0]?.episode.summary ?? translate('nodes.editSourceScript.pendingBody'),
          episodes: episodeItems.map((item) => item.episode),
        }
      : null)
    const error = group.find((snapshot) => snapshot.errorMessage)?.errorMessage ?? null
    if (!structure && !error) return []
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
      data: {
        body: error ?? structure?.summary ?? translate('nodes.editSourceScript.pendingBody'),
        meta: error ?? translate('nodes.editSourceScript.pendingMeta'),
        artifactPhase: error ? 'failed' : 'running',
        statusLabel: error ? translate('status.failed') : translate('status.processing'),
        isRunning: !error,
        streamPresentation: streamPresentation(rawItems),
        sourceScriptDetails: {
          sourceText: '',
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
    const key = `${snapshot.episodeId ?? snapshot.targetId}:${snapshot.targetId}`
    grouped.set(key, [...(grouped.get(key) ?? []), snapshot])
  })
  return [...grouped.values()].flatMap((group) => {
    const firstSnapshot = group[0] ?? null
    if (!firstSnapshot?.targetId) return []
    const globalBible = firstItemOfKind(group, 'productionPlanning.globalBible', 'productionPlanningGlobalBible')
    const beatItems = itemsOfKind(group, 'productionPlanning.beats', 'productionPlanningBeat')
    const ledgerItems = itemsOfKind(group, 'productionPlanning.ledgerEvents', 'productionPlanningLedgerEvent')
    const emotionalCueItems = itemsOfKind(group, 'productionPlanning.emotionalCues', 'productionPlanningEmotionalCue')
    const error = group.find((snapshot) => snapshot.errorMessage)?.errorMessage ?? null
    if (!globalBible && beatItems.length === 0 && ledgerItems.length === 0 && emotionalCueItems.length === 0 && !error) return []
    const rawItems = group.flatMap((snapshot) => snapshot.items)
    const nodeId = workspaceNodeId.editBible(firstSnapshot.episodeId ?? firstSnapshot.targetId)
    const body = error ?? productionPlanningBody({
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
      data: {
        body,
        meta: error ?? translate('nodes.editBible.pendingMeta'),
        artifactPhase: error ? 'failed' : 'running',
        statusLabel: error ? translate('status.failed') : translate('status.processing'),
        isRunning: !error,
        streamPresentation: streamPresentation(rawItems),
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
  const targetIds = Array.from(new Set(editScriptSnapshots.map((snapshot) => snapshot.targetId).filter((targetId): targetId is string => Boolean(targetId))))
  return targetIds.flatMap((targetId) => {
    const scopedSnapshots = editScriptSnapshots.filter((snapshot) => snapshot.targetId === targetId)
    const shotItems = itemsOfKind(scopedSnapshots, 'editScript.shots', 'editScriptShot')
    const error = scopedSnapshots.find((snapshot) => snapshot.errorMessage)?.errorMessage ?? null
    if (shotItems.length === 0 && !error) return []
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
      data: {
        body: error ?? translate('nodes.editScript.pendingBody'),
        meta: error
          ? error
          : translate('nodes.editScript.meta', {
              shots: shotItems.length,
              duration: durationSec,
              assets: 0,
              completed: 0,
            }),
        artifactPhase: error ? 'failed' : 'running',
        statusLabel: error ? translate('status.failed') : translate('status.processing'),
        isRunning: !error,
        streamPresentation: streamPresentation(rawItems),
        editScriptDetails: shotItems.length > 0 ? {
          durationSec,
          shotCount: shotItems.length,
          shots: shotItems
            .map(({ shot }) => ({
              shotId: shot.shotId,
              shotNumber: shot.shotNumber,
              durationSec: shot.durationSec,
              sceneName: shot.scene.name,
              action: shot.action,
              characters: shot.characters.map((character) => `${character.name} / ${character.visibility} / ${character.role}`),
              keyObjects: shot.keyObjects.map((object) => `${object.name} / ${object.role}`),
              imagePrompt: null,
              dialogue: shot.dialogue.map((line) => {
                const speaker = shot.characters.find((character) => character.characterId === line.characterId)?.name ?? line.characterId
                return `${speaker}: ${line.line}`
              }),
              sound: shot.sound,
              imageUrl: null,
              videoUrl: null,
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
  const error = matchingSnapshots.find((snapshot) => snapshot.errorMessage)?.errorMessage ?? null
  if (shotItems.length === 0 && !error) return null
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
    data: {
      body: error ?? translate('nodes.editShotExecutionPlan.pendingBody'),
      meta: error ?? translate('nodes.editShotExecutionPlan.meta', { shots: shotItems.length }),
      artifactPhase: error ? 'failed' : 'running',
      statusLabel: error ? translate('status.failed') : translate('status.processing'),
      isRunning: !error,
      streamPresentation: streamPresentation(rawItems),
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
  const designSections = itemsOfKind(snapshots, 'bgm.scoreDesign.sections', 'bgmDesignSection').map((item) => item.section)
  const promptSections = itemsOfKind(snapshots, 'bgm.promptSections', 'bgmPromptSection').map((item) => item.section)
  const virtualLayers = itemsOfKind(snapshots, 'bgm.virtualLayers', 'bgmVirtualLayer').map((item) => item.layer)
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey.startsWith('bgm.'))
    .flatMap((snapshot) => snapshot.items)
  const error = snapshots.find((snapshot) => snapshot.adapterKey.startsWith('bgm.') && snapshot.errorMessage)?.errorMessage ?? null
  if (designSections.length === 0 && promptSections.length === 0 && virtualLayers.length === 0 && !error) return null
  const firstSnapshot = snapshots.find((snapshot) => snapshot.adapterKey.startsWith('bgm.')) ?? null
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
    data: {
      body: error ?? translate('nodes.bgmScore.body', { videos: 0 }),
      meta: error ? error : translate('nodes.bgmScore.ready', { count: promptSections.length }),
      artifactPhase: error ? 'failed' : 'running',
      statusLabel: error ? translate('status.failed') : translate('status.processing'),
      isRunning: !error,
      streamPresentation: streamPresentation(rawItems),
      bgmScoreDetails: {
        status: error ? 'failed' : 'generating',
        durationSeconds: null,
        musicModel: null,
        hasPromptDesign: rawItems.length > 0,
        promptDesignMissing: false,
        designSectionCount: designSections.length,
        promptSectionCount: promptSections.length,
        virtualLayerCount: virtualLayers.length,
        mixUrl: null,
        errorMessage: error,
        scoreOverview: null,
        designSections: designSections.map((section) => ({
          category: section.category,
          title: section.title,
          purpose: section.purpose ?? null,
          startSec: section.startSec ?? null,
          endSec: section.endSec ?? null,
          content: section.content,
        })),
        promptSections: promptSections.map((section) => ({
          category: null,
          title: section.title,
          purpose: section.purpose ?? null,
          startSec: section.startSec ?? null,
          endSec: section.endSec ?? null,
          content: section.content,
        })),
        virtualLayers: virtualLayers.map((layer) => ({
          name: layer.name,
          purpose: layer.purpose,
          content: layer.content,
        })),
        finalPrompt: null,
      },
    },
  })
}

function buildSoundscapeRuntimeEntry(
  snapshots: readonly StructuredStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): WorkspaceCanvasStreamRuntimeEntry | null {
  const sources = itemsOfKind(snapshots, 'soundscape.sources', 'soundscapeSource').map((item) => item.source)
  const sections = itemsOfKind(snapshots, 'soundscape.sections', 'soundscapeSection').map((item) => item.section)
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey.startsWith('soundscape.'))
    .flatMap((snapshot) => snapshot.items)
  const error = snapshots.find((snapshot) => snapshot.adapterKey.startsWith('soundscape.') && snapshot.errorMessage)?.errorMessage ?? null
  if (sources.length === 0 && sections.length === 0 && !error) return null
  const firstSnapshot = snapshots.find((snapshot) => snapshot.adapterKey.startsWith('soundscape.')) ?? null
  if (!firstSnapshot) return null
  const nodeId = workspaceNodeId.soundscape(episodeId)
  return createStreamRuntimeEntry({
    nodeId,
    streamKind: 'soundscape',
    taskId: firstSnapshot.taskId,
    taskType: firstSnapshot.taskType,
    targetType: firstSnapshot.targetType,
    targetId: episodeId,
    episodeId: firstSnapshot.episodeId ?? episodeId,
    data: {
      body: error ?? translate('nodes.soundscape.body', { videos: 0 }),
      meta: error ? error : translate('nodes.soundscape.ready', { sources: sources.length, sections: sections.length }),
      artifactPhase: error ? 'failed' : 'running',
      statusLabel: error ? translate('status.failed') : translate('status.processing'),
      isRunning: !error,
      streamPresentation: streamPresentation(rawItems),
      soundscapeDetails: {
        status: error ? 'failed' : 'planning',
        decision: null,
        soundEffectModel: null,
        sourceCount: sources.length,
        sectionCount: sections.length,
        sources,
        sections,
        mixUrl: null,
        errorMessage: error,
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
    buildSoundscapeRuntimeEntry(snapshots, episodeId, translate),
  ].filter((entry): entry is WorkspaceCanvasStreamRuntimeEntry => entry !== null)
}

function hasPersistedStreamContentForPatch(
  baseNodes: readonly WorkspaceCanvasFlowNode[],
  patch: WorkspaceCanvasStreamPatch,
): boolean {
  const baseNode = baseNodes.find((node) => node.id === patch.nodeId) ?? null
  if (baseNode) {
    if (
      patch.streamKind === 'editSourceScript'
      && baseNode.data.kind === 'editSourceScript'
      && baseNode.data.sourceScriptDetails?.scriptStructure
      && baseNode.data.isRunning !== true
    ) {
      return true
    }
    if (
      patch.streamKind === 'editBible'
      && baseNode.data.kind === 'editBible'
      && baseNode.data.editBibleDetails
      && (
        baseNode.data.editBibleDetails.bible
        || baseNode.data.editBibleDetails.beatSheet
        || baseNode.data.editBibleDetails.ledger
        || baseNode.data.editBibleDetails.emotionalCurve
        || baseNode.data.editBibleDetails.chapters.length > 0
      )
      && baseNode.data.isRunning !== true
    ) {
      return true
    }
    if (
      patch.streamKind === 'editScript'
      && baseNode.data.kind === 'editScript'
      && baseNode.data.targetType === 'editScript'
      && (baseNode.data.editScriptDetails?.shots.length ?? 0) > 0
    ) {
      return true
    }
    if (
      patch.streamKind === 'editShotExecutionPlan'
      && baseNode.data.kind === 'editShotExecutionPlan'
      && (baseNode.data.editPipelineStepDetails?.items.length ?? 0) > 0
      && baseNode.data.isRunning !== true
    ) {
      return true
    }
    if (
      patch.streamKind === 'bgmScore'
      && baseNode.data.kind === 'bgmScore'
      && baseNode.data.bgmScoreDetails?.hasPromptDesign === true
      && baseNode.data.isRunning !== true
    ) {
      return true
    }
    if (
      patch.streamKind === 'soundscape'
      && baseNode.data.kind === 'soundscape'
      && baseNode.data.soundscapeDetails?.decision
      && baseNode.data.isRunning !== true
    ) {
      return true
    }
  }

  return false
}

export function applyWorkspaceStructuredStreamPatches(
  baseNodes: readonly WorkspaceCanvasFlowNode[],
  patches: readonly WorkspaceCanvasStreamPatch[],
): readonly WorkspaceCanvasFlowNode[] {
  if (patches.length === 0) return baseNodes

  const patchByNodeId = new Map(patches.map((patch) => [patch.nodeId, patch]))
  const usedPatchNodeIds = new Set<string>()
  const merged = baseNodes.map((node) => {
    const patch = patchByNodeId.get(node.id)
    if (!patch) return node
    usedPatchNodeIds.add(patch.nodeId)
    if (hasPersistedStreamContentForPatch(baseNodes, patch)) return node
    return {
      ...node,
      data: {
        ...node.data,
        ...patch.data,
        nodeId: node.id,
        layoutNodeType: node.data.layoutNodeType,
        targetType: node.data.targetType,
        targetId: node.data.targetId,
        runtimeTargets: node.data.runtimeTargets,
        actionLabel: node.data.actionLabel,
        action: node.data.action,
        actionDisabled: node.data.actionDisabled,
        secondaryActionLabel: node.data.secondaryActionLabel,
        secondaryAction: node.data.secondaryAction,
        tertiaryActionLabel: node.data.tertiaryActionLabel,
        tertiaryAction: node.data.tertiaryAction,
        onAction: node.data.onAction,
      },
    }
  })
  patches.forEach((patch) => {
    if (usedPatchNodeIds.has(patch.nodeId)) return
    if (hasPersistedStreamContentForPatch(baseNodes, patch)) return
    // Batch edit-first tasks can stream updates for chapters that are not part
    // of the current canvas projection. Keep those patches in runtime state and
    // apply them when their canonical node becomes visible after a refresh or
    // scope change; crashing here would make off-screen progress break the page.
  })
  return merged
}

export function useWorkspaceStructuredStreamRuntime({
  episodeId,
  translate,
}: UseWorkspaceStructuredStreamRuntimeInput): UseWorkspaceStructuredStreamRuntimeResult {
  const { subscribeTaskEvents } = useWorkspaceProvider()
  const [accumulators, setAccumulators] = useState<ReadonlyMap<string, StreamAccumulator>>(() => new Map())

  useEffect(() => {
    return subscribeTaskEvents((event) => {
      if ('episodeId' in event && event.episodeId && event.episodeId !== episodeId) return
      if (event.type === TASK_SSE_EVENT_TYPE.STREAM) {
        setAccumulators((current) => processStreamEvent(current, event))
        return
      }
      if (event.type !== TASK_SSE_EVENT_TYPE.LIFECYCLE) return
      const payload = readRecord(event.payload)
      const lifecycleType = readString(payload.lifecycleType)
      if (shouldClearStreamAccumulatorsForLifecycle(lifecycleType, payload)) {
        setAccumulators((current) => removeAccumulatorsForTask(current, event.taskId))
        return
      }
      if (
        lifecycleType !== TASK_EVENT_TYPE.COMPLETED
        && lifecycleType !== TASK_EVENT_TYPE.FAILED
      ) {
        return
      }
      setAccumulators((current) => removeAccumulatorsForTask(current, event.taskId))
    })
  }, [episodeId, subscribeTaskEvents])

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
  }), [entries])
}
