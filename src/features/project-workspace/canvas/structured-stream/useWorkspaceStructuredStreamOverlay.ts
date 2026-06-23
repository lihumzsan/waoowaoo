'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, type SSEEvent } from '@/lib/task/types'
import {
  appendStructuredJsonChunk,
  createStructuredStreamObjectParseState,
  createStructuredStreamParseState,
  type StructuredStreamParseState,
} from '@/lib/structured-stream/incremental-json'
import {
  WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_NODE_WIDTH,
  WORKSPACE_CANVAS_EDIT_PIPELINE_STEP_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCREENPLAY_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_TABLE_NODE_WIDTH,
  WORKSPACE_CANVAS_SPACE_CONSISTENCY_NODE_SIZE,
} from '../node-presentation-profiles'
import type {
  WorkspaceCanvasEditPipelineStepItem,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeData,
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

type TranslateValues = Readonly<Record<string, string | number>>
type Translate = (key: string, values?: TranslateValues) => string

interface UseWorkspaceStructuredStreamOverlayInput {
  readonly episodeId: string
  readonly translate: Translate
}

interface UseWorkspaceStructuredStreamOverlayResult {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
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

const STREAM_OVERLAY_RETIRE_MS = 8000

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

function createOverlayNode(params: {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly data: WorkspaceCanvasNodeData
}): WorkspaceCanvasFlowNode {
  return {
    id: params.id,
    type: 'workspaceNode',
    position: { x: params.x, y: params.y },
    data: {
      ...params.data,
      nodeId: params.id,
    },
    style: {
      width: params.data.width,
      height: params.data.height,
    },
  }
}

function extractScreenplayTitle(screenplayText: string): string {
  const firstLine = screenplayText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine) return ''
  return firstLine
    .replace(/^#+\s*/, '')
    .replace(/^标题[:：]\s*/, '')
    .replace(/^《(.+)》$/, '$1')
    .trim()
}

function buildEditScreenplayOverlays(
  snapshots: readonly TextStreamSnapshot[],
  translate: Translate,
): readonly WorkspaceCanvasFlowNode[] {
  const matchingSnapshots = snapshots.filter((snapshot) => snapshot.adapterKey === 'editScreenplay.text')
  return matchingSnapshots.flatMap((snapshot) => {
    if (snapshot.targetType !== 'ProjectEditScreenplay' || !snapshot.targetId) return []
    const screenplayText = snapshot.text.trim()
    if (!screenplayText) return []
    const screenplayTitle = extractScreenplayTitle(screenplayText)
    return [createOverlayNode({
      id: workspaceNodeId.editScreenplay(snapshot.targetId),
      x: 260,
      y: 430,
      data: {
        kind: 'editScreenplay',
        layoutNodeType: 'editScreenplay',
        targetType: 'editScreenplay',
        targetId: snapshot.targetId,
        title: screenplayTitle || translate('nodes.editScreenplay.pendingTitle'),
        eyebrow: translate('nodes.editScreenplay.eyebrow'),
        body: screenplayText,
        meta: translate('nodes.editScreenplay.pendingMeta'),
        statusLabel: translate('status.processing'),
        isRunning: true,
        width: WORKSPACE_CANVAS_EDIT_SCREENPLAY_NODE_SIZE.width,
        height: WORKSPACE_CANVAS_EDIT_SCREENPLAY_NODE_SIZE.height,
        indexLabel: 'S',
        defaultExpanded: true,
        streamPresentation: textStreamPresentation(),
        editScreenplayDetails: {
          screenplayText,
          userPrompt: '',
        },
      },
    })]
  })
}

function buildEditScriptOverlay(
  snapshots: readonly StructuredStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): WorkspaceCanvasFlowNode | null {
  const shotItems = itemsOfKind(snapshots, 'editScript.shots', 'editScriptShot')
  const error = snapshots.find((snapshot) => snapshot.adapterKey === 'editScript.shots' && snapshot.errorMessage)?.errorMessage ?? null
  if (shotItems.length === 0 && !error) return null
  const durationSec = shotItems.reduce((total, item) => total + item.shot.durationSec, 0)
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey === 'editScript.shots')
    .flatMap((snapshot) => snapshot.items)
  return createOverlayNode({
    id: workspaceNodeId.editScript(episodeId),
    x: 260,
    y: 430,
    data: {
      kind: 'editScript',
      layoutNodeType: 'editScript',
      targetType: 'episode',
      targetId: episodeId,
      title: translate('nodes.editScript.pendingTitle'),
      eyebrow: translate('nodes.editScript.eyebrow'),
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
      width: WORKSPACE_CANVAS_EDIT_SCRIPT_TABLE_NODE_WIDTH,
      height: 520,
      indexLabel: 'E',
      defaultExpanded: true,
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

function buildDirectorOverlay(
  snapshots: readonly StructuredStreamSnapshot[],
  translate: Translate,
): WorkspaceCanvasFlowNode | null {
  const shotItems = itemsOfKind(snapshots, 'directorDecoupage.shots', 'directorDecoupageShot')
  if (shotItems.length === 0) return null
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey === 'directorDecoupage.shots')
    .flatMap((snapshot) => snapshot.items)
  const screenplayId = findSnapshotTargetId(snapshots, 'directorDecoupage.shots', 'ProjectEditScreenplay')
  if (!screenplayId) return null
  return createOverlayNode({
    id: workspaceEditDirectorDecoupageNodeId(screenplayId),
    x: 260,
    y: 430,
    data: {
      kind: 'editDirectorDecoupage',
      layoutNodeType: 'editDirectorDecoupage',
      targetType: 'editScreenplay',
      targetId: screenplayId,
      title: translate('nodes.editDirectorDecoupage.title'),
      eyebrow: translate('nodes.editDirectorDecoupage.eyebrow'),
      body: translate('nodes.editDirectorDecoupage.body'),
      meta: translate('nodes.editDirectorDecoupage.meta', {
        shots: shotItems.length,
        duration: shotItems.reduce((total, item) => total + item.shot.durationSec, 0),
      }),
      statusLabel: translate('status.processing'),
      isRunning: true,
      width: WORKSPACE_CANVAS_EDIT_PIPELINE_STEP_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_EDIT_PIPELINE_STEP_NODE_SIZE.height,
      indexLabel: 'D',
      defaultExpanded: true,
      streamPresentation: streamPresentation(rawItems),
      editPipelineStepDetails: {
        items: pipelineItemsFromDirectorShots(shotItems, translate),
      },
    },
  })
}

function buildCinematographyOverlay(
  snapshots: readonly StructuredStreamSnapshot[],
  translate: Translate,
): WorkspaceCanvasFlowNode | null {
  const shotItems = itemsOfKind(snapshots, 'cinematography.shots', 'cinematographyShot')
  if (shotItems.length === 0) return null
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey === 'cinematography.shots')
    .flatMap((snapshot) => snapshot.items)
  const editScriptId = findSnapshotTargetId(snapshots, 'cinematography.shots', 'ProjectEditScript')
  if (!editScriptId) return null
  return createOverlayNode({
    id: workspaceEditCinematographyShotPlanNodeId(editScriptId),
    x: 1092,
    y: 430,
    data: {
      kind: 'editCinematographyShotPlan',
      layoutNodeType: 'editCinematographyShotPlan',
      targetType: 'editScript',
      targetId: editScriptId,
      title: translate('nodes.editCinematographyShotPlan.title'),
      eyebrow: translate('nodes.editCinematographyShotPlan.eyebrow'),
      body: translate('nodes.editCinematographyShotPlan.pendingBody'),
      meta: translate('nodes.editCinematographyShotPlan.meta', { shots: shotItems.length }),
      statusLabel: translate('status.processing'),
      isRunning: true,
      width: WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_NODE_WIDTH,
      height: 360,
      indexLabel: 'C',
      defaultExpanded: true,
      streamPresentation: streamPresentation(rawItems),
      editPipelineStepDetails: {
        items: pipelineItemsFromCinematographyShots(shotItems, translate),
      },
    },
  })
}

function buildSpaceConsistencyOverlays(
  snapshots: readonly StructuredStreamSnapshot[],
  translate: Translate,
): readonly WorkspaceCanvasFlowNode[] {
  const matchingSnapshots = snapshots.filter((snapshot) => snapshot.adapterKey === 'storyboard.panels')
  return matchingSnapshots.flatMap((snapshot) => {
    const storyboardId = snapshot.targetId
    if (!storyboardId) return []
    const panels = snapshot.items.flatMap((item) => item.value.kind === 'storyboardPanel' ? [item.value.panel] : [])
    if (panels.length === 0 && !snapshot.errorMessage) return []
    return [createOverlayNode({
      id: workspaceNodeId.spaceConsistency(storyboardId),
      x: 2048,
      y: 430,
      data: {
        kind: 'spaceConsistency',
        layoutNodeType: 'spaceConsistency',
        targetType: 'storyboard',
        targetId: storyboardId,
        title: translate('nodes.spaceConsistency.title'),
        eyebrow: translate('nodes.spaceConsistency.eyebrow'),
        body: snapshot.errorMessage ?? translate('nodes.spaceConsistency.body'),
        meta: translate('nodes.spaceConsistency.meta', { profiles: 0, cameraPlans: panels.length }),
        statusLabel: snapshot.errorMessage ? translate('status.failed') : translate('status.processing'),
        isRunning: !snapshot.errorMessage,
        width: WORKSPACE_CANVAS_SPACE_CONSISTENCY_NODE_SIZE.width,
        height: WORKSPACE_CANVAS_SPACE_CONSISTENCY_NODE_SIZE.height,
        indexLabel: 'S',
        defaultExpanded: true,
        streamPresentation: streamPresentation(snapshot.items),
        spaceConsistencyDetails: {
          storyboardId,
          stage: 'panel_prompts_streaming',
          spatialProfileCount: 0,
          cameraPlanCount: panels.length,
          spatialProfiles: [],
          cameraPlans: panels.map((panel) => ({
            panelIndex: panel.panelIndex,
            sourceShotNumber: panel.sourceShotNumber,
            sourceVideoBlockId: panel.sourceVideoBlockId,
            shotBlocking: panel.shotBlocking,
          })),
        },
      },
    })]
  })
}

function buildBgmOverlay(
  snapshots: readonly StructuredStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): WorkspaceCanvasFlowNode | null {
  const designSections = itemsOfKind(snapshots, 'bgm.scoreDesign.sections', 'bgmDesignSection').map((item) => item.section)
  const promptSections = itemsOfKind(snapshots, 'bgm.promptSections', 'bgmPromptSection').map((item) => item.section)
  const virtualLayers = itemsOfKind(snapshots, 'bgm.virtualLayers', 'bgmVirtualLayer').map((item) => item.layer)
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey.startsWith('bgm.'))
    .flatMap((snapshot) => snapshot.items)
  const error = snapshots.find((snapshot) => snapshot.adapterKey.startsWith('bgm.') && snapshot.errorMessage)?.errorMessage ?? null
  if (designSections.length === 0 && promptSections.length === 0 && virtualLayers.length === 0 && !error) return null
  return createOverlayNode({
    id: workspaceNodeId.bgmScore(episodeId),
    x: 2048,
    y: 1180,
    data: {
      kind: 'bgmScore',
      layoutNodeType: 'bgmScore',
      targetType: 'episode',
      targetId: episodeId,
      title: translate('nodes.bgmScore.title'),
      eyebrow: translate('nodes.bgmScore.eyebrow'),
      body: error ?? translate('nodes.bgmScore.body', { videos: 0 }),
      meta: error ? error : translate('nodes.bgmScore.ready', { count: promptSections.length }),
      statusLabel: error ? translate('status.failed') : translate('status.generatingBgm'),
      isRunning: !error,
      width: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height,
      indexLabel: 'M',
      defaultExpanded: true,
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
        negativePrompt: null,
      },
    },
  })
}

function buildOverlayNodes(
  snapshots: readonly StructuredStreamSnapshot[],
  textSnapshots: readonly TextStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): readonly WorkspaceCanvasFlowNode[] {
  return [
    ...buildEditScreenplayOverlays(textSnapshots, translate),
    buildDirectorOverlay(snapshots, translate),
    buildEditScriptOverlay(snapshots, episodeId, translate),
    buildCinematographyOverlay(snapshots, translate),
    ...buildSpaceConsistencyOverlays(snapshots, translate),
    buildBgmOverlay(snapshots, episodeId, translate),
  ].filter((node): node is WorkspaceCanvasFlowNode => node !== null)
}

export function mergeWorkspaceStructuredStreamOverlayNodes(
  baseNodes: readonly WorkspaceCanvasFlowNode[],
  overlayNodes: readonly WorkspaceCanvasFlowNode[],
): readonly WorkspaceCanvasFlowNode[] {
  if (overlayNodes.length === 0) return baseNodes

  const finalDataKinds = new Set<string>()
  baseNodes.forEach((node) => {
    if (node.data.kind === 'editScreenplay' && node.data.editScreenplayDetails && node.data.isRunning !== true) {
      finalDataKinds.add(`editScreenplay:${node.data.targetId}`)
    }
    if (node.data.kind === 'editScript' && node.data.targetType === 'editScript' && node.data.editScriptDetails) {
      finalDataKinds.add('editScript')
    }
    if (node.data.kind === 'editDirectorDecoupage' && node.data.editPipelineStepDetails && node.data.isRunning !== true) {
      finalDataKinds.add('editDirectorDecoupage')
    }
    if (node.data.kind === 'editCinematographyShotPlan' && node.data.editPipelineStepDetails && node.data.isRunning !== true) {
      finalDataKinds.add('editCinematographyShotPlan')
    }
    if (node.data.kind === 'bgmScore' && node.data.bgmScoreDetails?.hasPromptDesign === true && node.data.isRunning !== true) {
      finalDataKinds.add('bgmScore')
    }
    if (node.data.kind === 'spaceConsistency' && (node.data.spaceConsistencyDetails?.cameraPlanCount ?? 0) > 0 && node.data.isRunning !== true) {
      finalDataKinds.add(`spaceConsistency:${node.data.targetId}`)
    }
  })

  const usableOverlays = overlayNodes.filter((node) => {
    if (node.data.kind === 'editScreenplay' && finalDataKinds.has(`editScreenplay:${node.data.targetId}`)) return false
    if (node.data.kind === 'editScript' && finalDataKinds.has('editScript')) return false
    if (node.data.kind === 'editDirectorDecoupage' && finalDataKinds.has('editDirectorDecoupage')) return false
    if (node.data.kind === 'editCinematographyShotPlan' && finalDataKinds.has('editCinematographyShotPlan')) return false
    if (node.data.kind === 'bgmScore' && finalDataKinds.has('bgmScore')) return false
    if (node.data.kind === 'spaceConsistency' && finalDataKinds.has(`spaceConsistency:${node.data.targetId}`)) return false
    return true
  })
  const overlayById = new Map(usableOverlays.map((node) => [node.id, node]))
  const usedOverlayIds = new Set<string>()
  const merged = baseNodes.map((node) => {
    const overlay = overlayById.get(node.id)
    if (!overlay) return node
    usedOverlayIds.add(overlay.id)
    return {
      ...overlay,
      position: node.position,
      style: {
        ...node.style,
        width: overlay.data.width,
        height: overlay.data.height,
      },
      data: {
        ...node.data,
        ...overlay.data,
        nodeId: node.id,
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
  usableOverlays.forEach((overlay) => {
    if (!usedOverlayIds.has(overlay.id)) merged.push(overlay)
  })
  return merged
}

export function useWorkspaceStructuredStreamOverlay({
  episodeId,
  translate,
}: UseWorkspaceStructuredStreamOverlayInput): UseWorkspaceStructuredStreamOverlayResult {
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
      }, STREAM_OVERLAY_RETIRE_MS)
      retireTimersRef.current.set(event.taskId, timer)
    })
  }, [episodeId, subscribeTaskEvents])

  useEffect(() => () => {
    retireTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    retireTimersRef.current.clear()
  }, [])

  const nodes = useMemo(
    () => buildOverlayNodes(
      snapshotsFromAccumulators(accumulators),
      textSnapshotsFromAccumulators(textAccumulators),
      episodeId,
      translate,
    ),
    [accumulators, textAccumulators, episodeId, translate],
  )

  return { nodes }
}
