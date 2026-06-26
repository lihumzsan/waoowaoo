'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  findTextStreamAdapters,
  findStructuredStreamAdapters,
  type StructuredStreamAdapter,
  type StructuredStreamAdapterKey,
  type StructuredStreamItem,
  type StructuredStreamParsedItem,
  type TextStreamAdapter,
  type TextStreamAdapterKey,
} from './structured-stream-adapters'
import {
  workspaceNodeId,
  workspaceEditCinematographyShotPlanNodeId,
  workspaceEditDirectorDecoupageNodeId,
} from '../workspace-canvas-node-ids'
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

interface StructuredStreamSnapshot {
  readonly taskId: string
  readonly taskType: string | null
  readonly targetType: string | null
  readonly targetId: string | null
  readonly episodeId: string | null
  readonly adapterKey: StructuredStreamAdapterKey
  readonly items: readonly StructuredStreamItem[]
  readonly errorMessage: string | null
}

interface TextStreamAccumulator {
  readonly taskId: string
  readonly taskType: string | null
  readonly targetType: string | null
  readonly targetId: string | null
  readonly episodeId: string | null
  readonly stepId: string | null
  readonly streamRunId: string
  readonly lane: string
  readonly adapter: TextStreamAdapter
  readonly text: string
}

interface TextStreamSnapshot {
  readonly taskId: string
  readonly taskType: string | null
  readonly targetType: string | null
  readonly targetId: string | null
  readonly episodeId: string | null
  readonly adapterKey: TextStreamAdapterKey
  readonly text: string
}

const STREAM_RUNTIME_RETIRE_MS = 8000

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readRawString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function durationLabel(seconds: number): string {
  return `${seconds}s`
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

function createTextAccumulatorKey(input: {
  readonly taskId: string
  readonly streamRunId: string
  readonly stepId: string | null
  readonly lane: string
  readonly adapterKey: TextStreamAdapterKey
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

function processTextStreamEvent(
  current: ReadonlyMap<string, TextStreamAccumulator>,
  event: SSEEvent,
): ReadonlyMap<string, TextStreamAccumulator> {
  if (event.type !== TASK_SSE_EVENT_TYPE.STREAM) return current
  const payload = readRecord(event.payload)
  const stream = readRecord(payload.stream)
  const delta = readRawString(stream.delta)
  const kind = readString(stream.kind)
  if (!delta || kind !== 'text') return current

  const stepId = readString(payload.stepId)
  const streamRunId = readString(payload.streamRunId) ?? `run:${event.taskId}`
  const lane = readString(stream.lane) ?? 'main'
  if (lane !== 'main') return current

  const adapters = findTextStreamAdapters({
    taskType: event.taskType ?? null,
    stepId,
  })
  if (adapters.length === 0) return current

  const next = new Map(current)
  adapters.forEach((adapter) => {
    const key = createTextAccumulatorKey({
      taskId: event.taskId,
      streamRunId,
      stepId,
      lane,
      adapterKey: adapter.key,
    })
    const previous = next.get(key)
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
      text: `${previous?.text ?? ''}${delta}`,
    })
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

function textSnapshotsFromAccumulators(
  accumulators: ReadonlyMap<string, TextStreamAccumulator>,
): readonly TextStreamSnapshot[] {
  return [...accumulators.values()]
    .filter((accumulator) => accumulator.text.trim().length > 0)
    .map((accumulator) => ({
      taskId: accumulator.taskId,
      taskType: accumulator.taskType,
      targetType: accumulator.targetType,
      targetId: accumulator.targetId,
      episodeId: accumulator.episodeId,
      adapterKey: accumulator.adapter.key,
      text: accumulator.text,
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

function textStreamPresentation(): WorkspaceCanvasStreamPresentation {
  return {
    isStreaming: true,
    activeItemKey: 'screenplay',
    displayedItemKeys: ['screenplay'],
    pinnedItemKeys: [],
    revealedFieldCountByKey: { screenplay: Number.MAX_SAFE_INTEGER },
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

function findSnapshotTargetId(
  snapshots: readonly StructuredStreamSnapshot[],
  adapterKey: StructuredStreamAdapterKey,
  targetType: string,
): string | null {
  return snapshots.find((snapshot) => (
    snapshot.adapterKey === adapterKey
    && snapshot.targetType === targetType
    && snapshot.targetId
  ))?.targetId ?? null
}

function pipelineItemsFromDirectorShots(
  items: Array<Extract<StructuredStreamParsedItem, { readonly kind: 'directorDecoupageShot' }>>,
  translate: Translate,
): WorkspaceCanvasEditPipelineStepItem[] {
  return items.map(({ shot }) => ({
    title: translate('nodeFields.shotIndex', { index: shot.shotNumber }),
    fields: [
      { label: translate('nodeFields.duration'), value: durationLabel(shot.durationSec) },
      { label: translate('nodeFields.dramaticPurpose'), value: shot.dramaticPurpose },
      { label: translate('nodeFields.audienceFocus'), value: shot.audienceFocus },
      { label: translate('nodeFields.viewpoint'), value: shot.viewpoint },
      { label: translate('nodeFields.revealPlan'), value: shot.revealPlan },
      { label: translate('nodeFields.performanceBeat'), value: shot.performanceBeat },
      { label: translate('nodeFields.continuityIn'), value: shot.continuityIn },
      { label: translate('nodeFields.continuityOut'), value: shot.continuityOut },
      { label: translate('nodeFields.sound'), value: shot.sound },
    ],
    body: shot.visibleAction,
    chips: [String(shot.shotNumber)],
  }))
}

function pipelineItemsFromCinematographyShots(
  items: Array<Extract<StructuredStreamParsedItem, { readonly kind: 'cinematographyShot' }>>,
  translate: Translate,
): WorkspaceCanvasEditPipelineStepItem[] {
  return items.map(({ shot }) => ({
    title: translate('nodeFields.shotIndex', { index: shot.shotNumber }),
    fields: [
      { label: translate('nodeFields.shotScale'), value: shot.shotScale },
      { label: translate('nodeFields.lens'), value: shot.lens },
      { label: translate('nodeFields.depthOfField'), value: shot.depthOfField },
      { label: translate('nodeFields.cameraPosition'), value: shot.cameraPosition },
      { label: translate('nodeFields.cameraHeight'), value: shot.cameraHeight },
      { label: translate('nodeFields.cameraAngle'), value: shot.cameraAngle },
      { label: translate('nodeFields.movement'), value: shot.movement },
      { label: translate('nodeFields.lighting'), value: shot.lighting },
      { label: translate('nodeFields.axisAndEyeline'), value: shot.axisAndEyeline },
      { label: translate('nodeFields.continuityIn'), value: shot.continuityIn },
      { label: translate('nodeFields.continuityOut'), value: shot.continuityOut },
    ],
    body: shot.composition,
    chips: [String(shot.shotNumber)],
  }))
}

function pipelineItemsFromStoryboardPanels(
  panels: readonly Extract<StructuredStreamParsedItem, { readonly kind: 'storyboardPanel' }>['panel'][],
  translate: Translate,
): WorkspaceCanvasEditPipelineStepItem[] {
  return panels.map((panel) => ({
    title: translate('nodeFields.shotIndex', { index: panel.sourceShotNumber }),
    fields: [
      { label: translate('nodeFields.imagePrompt'), value: panel.finalPanelPrompt },
      { label: translate('nodeFields.videoPrompt'), value: panel.finalVideoPrompt },
    ],
    body: panel.finalPanelPrompt,
    chips: [String(panel.sourceShotNumber)],
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

function buildEditScreenplayRuntimeEntries(
  snapshots: readonly TextStreamSnapshot[],
  translate: Translate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  const matchingSnapshots = snapshots.filter((snapshot) => snapshot.adapterKey === 'editScreenplay.text')
  return matchingSnapshots.flatMap((snapshot) => {
    if (snapshot.targetType !== 'ProjectEditScreenplay' || !snapshot.targetId) return []
    const screenplayText = snapshot.text.trim()
    if (!screenplayText) return []
    const nodeId = workspaceNodeId.editScreenplay(snapshot.targetId)
    return [createStreamRuntimeEntry({
      nodeId,
      streamKind: 'editScreenplay',
      taskId: snapshot.taskId,
      taskType: snapshot.taskType,
      targetType: snapshot.targetType,
      targetId: snapshot.targetId,
      episodeId: snapshot.episodeId,
      data: {
        body: screenplayText,
        meta: translate('nodes.editScreenplay.pendingMeta'),
        statusLabel: translate('status.processing'),
        isRunning: true,
        streamPresentation: textStreamPresentation(),
        editScreenplayDetails: {
          screenplayText,
          userPrompt: '',
        },
      },
    })]
  })
}

function buildEditScriptRuntimeEntry(
  snapshots: readonly StructuredStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): WorkspaceCanvasStreamRuntimeEntry | null {
  const shotItems = itemsOfKind(snapshots, 'editScript.shots', 'editScriptShot')
  const error = snapshots.find((snapshot) => snapshot.adapterKey === 'editScript.shots' && snapshot.errorMessage)?.errorMessage ?? null
  if (shotItems.length === 0 && !error) return null
  const firstSnapshot = snapshots.find((snapshot) => snapshot.adapterKey === 'editScript.shots') ?? null
  if (!firstSnapshot) return null
  const durationSec = shotItems.reduce((total, item) => total + item.shot.durationSec, 0)
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey === 'editScript.shots')
    .flatMap((snapshot) => snapshot.items)
  const nodeId = workspaceNodeId.editScript(episodeId)
  return createStreamRuntimeEntry({
    nodeId,
    streamKind: 'editScript',
    taskId: firstSnapshot.taskId,
    taskType: firstSnapshot.taskType,
    targetType: firstSnapshot.targetType,
    targetId: episodeId,
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
      statusLabel: error ? translate('status.failed') : translate('status.processing'),
      isRunning: !error,
      streamPresentation: streamPresentation(rawItems),
      editScriptDetails: shotItems.length > 0 ? {
        durationSec,
        shotCount: shotItems.length,
        shots: shotItems.map(({ shot }) => ({
          ...shot,
          imagePrompt: null,
          imageUrl: null,
          videoUrl: null,
        })),
      } : undefined,
    },
  })
}

function buildDirectorRuntimeEntry(
  snapshots: readonly StructuredStreamSnapshot[],
  translate: Translate,
): WorkspaceCanvasStreamRuntimeEntry | null {
  const shotItems = itemsOfKind(snapshots, 'directorDecoupage.shots', 'directorDecoupageShot')
  if (shotItems.length === 0) return null
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey === 'directorDecoupage.shots')
    .flatMap((snapshot) => snapshot.items)
  const firstSnapshot = snapshots.find((snapshot) => snapshot.adapterKey === 'directorDecoupage.shots') ?? null
  const screenplayId = findSnapshotTargetId(snapshots, 'directorDecoupage.shots', 'ProjectEditScreenplay')
  if (!screenplayId) return null
  if (!firstSnapshot) return null
  const nodeId = workspaceEditDirectorDecoupageNodeId(screenplayId)
  return createStreamRuntimeEntry({
    nodeId,
    streamKind: 'editDirectorDecoupage',
    taskId: firstSnapshot.taskId,
    taskType: firstSnapshot.taskType,
    targetType: firstSnapshot.targetType,
    targetId: screenplayId,
    episodeId: firstSnapshot.episodeId,
    data: {
      body: translate('nodes.editDirectorDecoupage.body'),
      meta: translate('nodes.editDirectorDecoupage.meta', {
        shots: shotItems.length,
        duration: shotItems.reduce((total, item) => total + item.shot.durationSec, 0),
      }),
      statusLabel: translate('status.processing'),
      isRunning: true,
      streamPresentation: streamPresentation(rawItems),
      editPipelineStepDetails: {
        items: pipelineItemsFromDirectorShots(shotItems, translate),
      },
    },
  })
}

function buildCinematographyRuntimeEntry(
  snapshots: readonly StructuredStreamSnapshot[],
  translate: Translate,
): WorkspaceCanvasStreamRuntimeEntry | null {
  const shotItems = itemsOfKind(snapshots, 'cinematography.shots', 'cinematographyShot')
  if (shotItems.length === 0) return null
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey === 'cinematography.shots')
    .flatMap((snapshot) => snapshot.items)
  const firstSnapshot = snapshots.find((snapshot) => snapshot.adapterKey === 'cinematography.shots') ?? null
  const editScriptId = findSnapshotTargetId(snapshots, 'cinematography.shots', 'ProjectEditScript')
  if (!editScriptId) return null
  if (!firstSnapshot) return null
  const nodeId = workspaceEditCinematographyShotPlanNodeId(editScriptId)
  return createStreamRuntimeEntry({
    nodeId,
    streamKind: 'editCinematographyShotPlan',
    taskId: firstSnapshot.taskId,
    taskType: firstSnapshot.taskType,
    targetType: firstSnapshot.targetType,
    targetId: editScriptId,
    episodeId: firstSnapshot.episodeId,
    data: {
      body: translate('nodes.editCinematographyShotPlan.pendingBody'),
      meta: translate('nodes.editCinematographyShotPlan.meta', { shots: shotItems.length }),
      statusLabel: translate('status.processing'),
      isRunning: true,
      streamPresentation: streamPresentation(rawItems),
      editPipelineStepDetails: {
        items: pipelineItemsFromCinematographyShots(shotItems, translate),
      },
    },
  })
}

function buildStoryboardPanelGenerationRuntimeEntries(
  snapshots: readonly StructuredStreamSnapshot[],
  translate: Translate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  const matchingSnapshots = snapshots.filter((snapshot) => snapshot.adapterKey === 'storyboard.panels')
  return matchingSnapshots.flatMap((snapshot) => {
    const storyboardId = snapshot.targetId
    if (!storyboardId) return []
    const panels = snapshot.items.flatMap((item) => item.value.kind === 'storyboardPanel' ? [item.value.panel] : [])
    if (panels.length === 0 && !snapshot.errorMessage) return []
    const nodeId = workspaceNodeId.storyboardPanelGeneration(storyboardId)
    return [createStreamRuntimeEntry({
      nodeId,
      streamKind: 'storyboardPanelGeneration',
      taskId: snapshot.taskId,
      taskType: snapshot.taskType,
      targetType: snapshot.targetType,
      targetId: storyboardId,
      episodeId: snapshot.episodeId,
      data: {
        body: snapshot.errorMessage ?? translate('nodes.storyboardPanelGeneration.body'),
        meta: translate('nodes.storyboardPanelGeneration.meta', { panels: panels.length }),
        statusLabel: snapshot.errorMessage ? translate('status.failed') : translate('status.processing'),
        isRunning: !snapshot.errorMessage,
        streamPresentation: streamPresentation(snapshot.items),
        editPipelineStepDetails: {
          items: pipelineItemsFromStoryboardPanels(panels, translate),
        },
      },
    })]
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
      statusLabel: error ? translate('status.failed') : translate('status.generatingBgm'),
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

function buildStreamRuntimeEntries(
  snapshots: readonly StructuredStreamSnapshot[],
  textSnapshots: readonly TextStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  return [
    ...buildEditScreenplayRuntimeEntries(textSnapshots, translate),
    buildDirectorRuntimeEntry(snapshots, translate),
    buildEditScriptRuntimeEntry(snapshots, episodeId, translate),
    buildCinematographyRuntimeEntry(snapshots, translate),
    ...buildStoryboardPanelGenerationRuntimeEntries(snapshots, translate),
    buildBgmRuntimeEntry(snapshots, episodeId, translate),
  ].filter((entry): entry is WorkspaceCanvasStreamRuntimeEntry => entry !== null)
}

function storyboardIdFromPanelGenerationNodeId(nodeId: string): string | null {
  const prefix = 'storyboard-panel-generation:'
  return nodeId.startsWith(prefix) ? nodeId.slice(prefix.length) : null
}

function hasPersistedStreamContentForPatch(
  baseNodes: readonly WorkspaceCanvasFlowNode[],
  patch: WorkspaceCanvasStreamPatch,
): boolean {
  const baseNode = baseNodes.find((node) => node.id === patch.nodeId) ?? null
  if (baseNode) {
    if (
      patch.streamKind === 'editScreenplay'
      && baseNode.data.kind === 'editScreenplay'
      && baseNode.data.editScreenplayDetails
      && baseNode.data.editScreenplayDetails.screenplayText.trim().length > 0
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
      patch.streamKind === 'editDirectorDecoupage'
      && baseNode.data.kind === 'editDirectorDecoupage'
      && (baseNode.data.editPipelineStepDetails?.items.length ?? 0) > 0
      && baseNode.data.isRunning !== true
    ) {
      return true
    }
    if (
      patch.streamKind === 'editCinematographyShotPlan'
      && baseNode.data.kind === 'editCinematographyShotPlan'
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
  }

  if (patch.streamKind !== 'storyboardPanelGeneration') return false
  const storyboardId = storyboardIdFromPanelGenerationNodeId(patch.nodeId)
  if (!storyboardId) return false
  return baseNodes.some((node) => (
    node.data.kind === 'shot'
    && node.data.storyboardId === storyboardId
    && node.data.isRunning !== true
  ))
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
    throw new Error(`WORKSPACE_STREAM_PATCH_WITHOUT_CANONICAL_NODE:${patch.streamKind}:${patch.nodeId}:${patch.taskId}`)
  })
  return merged
}

export function useWorkspaceStructuredStreamRuntime({
  episodeId,
  translate,
}: UseWorkspaceStructuredStreamRuntimeInput): UseWorkspaceStructuredStreamRuntimeResult {
  const { subscribeTaskEvents } = useWorkspaceProvider()
  const [accumulators, setAccumulators] = useState<ReadonlyMap<string, StreamAccumulator>>(() => new Map())
  const [textAccumulators, setTextAccumulators] = useState<ReadonlyMap<string, TextStreamAccumulator>>(() => new Map())
  const retireTimersRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    return subscribeTaskEvents((event) => {
      if ('episodeId' in event && event.episodeId && event.episodeId !== episodeId) return
      if (event.type === TASK_SSE_EVENT_TYPE.STREAM) {
        setAccumulators((current) => processStreamEvent(current, event))
        setTextAccumulators((current) => processTextStreamEvent(current, event))
        return
      }
      if (event.type !== TASK_SSE_EVENT_TYPE.LIFECYCLE) return
      const payload = readRecord(event.payload)
      const lifecycleType = readString(payload.lifecycleType)
      if (shouldClearStreamAccumulatorsForLifecycle(lifecycleType, payload)) {
        const previousTimer = retireTimersRef.current.get(event.taskId)
        if (previousTimer !== undefined) window.clearTimeout(previousTimer)
        retireTimersRef.current.delete(event.taskId)
        setAccumulators((current) => removeAccumulatorsForTask(current, event.taskId))
        setTextAccumulators((current) => removeAccumulatorsForTask(current, event.taskId))
        return
      }
      if (
        lifecycleType !== TASK_EVENT_TYPE.COMPLETED
        && lifecycleType !== TASK_EVENT_TYPE.FAILED
      ) {
        return
      }
      const previousTimer = retireTimersRef.current.get(event.taskId)
      if (previousTimer !== undefined) window.clearTimeout(previousTimer)
      const timer = window.setTimeout(() => {
        retireTimersRef.current.delete(event.taskId)
        setAccumulators((current) => removeAccumulatorsForTask(current, event.taskId))
        setTextAccumulators((current) => removeAccumulatorsForTask(current, event.taskId))
      }, STREAM_RUNTIME_RETIRE_MS)
      retireTimersRef.current.set(event.taskId, timer)
    })
  }, [episodeId, subscribeTaskEvents])

  useEffect(() => () => {
    retireTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    retireTimersRef.current.clear()
  }, [])

  const entries = useMemo(
    () => buildStreamRuntimeEntries(
      snapshotsFromAccumulators(accumulators),
      textSnapshotsFromAccumulators(textAccumulators),
      episodeId,
      translate,
    ),
    [accumulators, textAccumulators, episodeId, translate],
  )

  return useMemo(() => ({
    targets: entries.map((entry) => entry.target),
    patches: entries.map((entry) => entry.patch),
  }), [entries])
}
