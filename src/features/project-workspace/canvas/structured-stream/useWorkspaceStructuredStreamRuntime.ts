'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, type SSEEvent } from '@/lib/task/types'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
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
  readonly stepId: string | null
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
      stepId: accumulator.stepId,
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
    activeItemKey: 'bible',
    displayedItemKeys: ['bible'],
    pinnedItemKeys: [],
    revealedFieldCountByKey: { bible: Number.MAX_SAFE_INTEGER },
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

function buildEditBibleRuntimeEntries(
  snapshots: readonly TextStreamSnapshot[],
  translate: Translate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  const matchingSnapshots = snapshots.filter((snapshot) => snapshot.adapterKey === 'editBible.text')
  const stepOrder = [
    AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL,
    AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET,
    AI_PROMPT_IDS.EDIT_BIBLE_LEDGER,
    AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE,
  ] as const
  const grouped = new Map<string, TextStreamSnapshot[]>()
  matchingSnapshots.forEach((snapshot) => {
    if (snapshot.targetType !== 'ProjectEditBible' || !snapshot.targetId) return
    const key = `${snapshot.episodeId ?? snapshot.targetId}:${snapshot.targetId}`
    grouped.set(key, [...(grouped.get(key) ?? []), snapshot])
  })
  return [...grouped.values()].flatMap((group) => {
    const firstSnapshot = group[0] ?? null
    if (!firstSnapshot?.targetId) return []
    const bibleText = group
      .slice()
      .sort((left, right) => stepOrder.indexOf(left.stepId as (typeof stepOrder)[number]) - stepOrder.indexOf(right.stepId as (typeof stepOrder)[number]))
      .map((snapshot) => snapshot.text.trim())
      .filter(Boolean)
      .join('\n\n')
    if (!bibleText) return []
    const nodeId = workspaceNodeId.editBible(firstSnapshot.episodeId ?? firstSnapshot.targetId)
    return [createStreamRuntimeEntry({
      nodeId,
      streamKind: 'editBible',
      taskId: firstSnapshot.taskId,
      taskType: firstSnapshot.taskType,
      targetType: firstSnapshot.targetType,
      targetId: firstSnapshot.targetId,
      episodeId: firstSnapshot.episodeId,
      data: {
        body: bibleText,
        meta: translate('nodes.editBible.pendingMeta'),
        artifactPhase: 'running',
        statusLabel: translate('status.processing'),
        isRunning: true,
        streamPresentation: textStreamPresentation(),
        editBibleDetails: {
          bibleText,
          userPrompt: '',
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
  const shotItems = itemsOfKind(snapshots, 'shotExecutionPlan.shots', 'shotExecutionPlanShot')
  if (shotItems.length === 0) return null
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey === 'shotExecutionPlan.shots')
    .flatMap((snapshot) => snapshot.items)
  const firstSnapshot = snapshots.find((snapshot) => snapshot.adapterKey === 'shotExecutionPlan.shots') ?? null
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
      body: translate('nodes.editShotExecutionPlan.pendingBody'),
      meta: translate('nodes.editShotExecutionPlan.meta', { shots: shotItems.length }),
      artifactPhase: 'running',
      statusLabel: translate('status.processing'),
      isRunning: true,
      streamPresentation: streamPresentation(rawItems),
      editPipelineStepDetails: {
        items: pipelineItemsFromShotExecutionPlan(shotItems, translate),
      },
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

function buildStreamRuntimeEntries(
  snapshots: readonly StructuredStreamSnapshot[],
  textSnapshots: readonly TextStreamSnapshot[],
  episodeId: string,
  translate: Translate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  return [
    ...buildEditBibleRuntimeEntries(textSnapshots, translate),
    ...buildEditScriptRuntimeEntries(snapshots, episodeId, translate),
    buildShotExecutionRuntimeEntry(snapshots, translate),
    buildBgmRuntimeEntry(snapshots, episodeId, translate),
  ].filter((entry): entry is WorkspaceCanvasStreamRuntimeEntry => entry !== null)
}

function hasPersistedStreamContentForPatch(
  baseNodes: readonly WorkspaceCanvasFlowNode[],
  patch: WorkspaceCanvasStreamPatch,
): boolean {
  const baseNode = baseNodes.find((node) => node.id === patch.nodeId) ?? null
  if (baseNode) {
    if (
      patch.streamKind === 'editBible'
      && baseNode.data.kind === 'editBible'
      && baseNode.data.editBibleDetails
      && baseNode.data.editBibleDetails.bibleText.trim().length > 0
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
