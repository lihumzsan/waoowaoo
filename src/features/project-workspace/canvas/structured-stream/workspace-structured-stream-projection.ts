import { normalizeSourceScriptSegments } from '@/lib/edit-bible/source-script-segments'
import type { EditSourceScriptStructure } from '@/lib/edit-bible/schemas'
import type {
  StructuredStreamAdapterKey,
  StructuredStreamItem,
  StructuredStreamParsedItem,
} from '@/lib/structured-stream/workspace-structured-stream-adapters'
import type {
  WorkspaceCanvasEditPipelineStepItem,
  WorkspaceCanvasStreamPresentation,
} from '../node-canvas-types'
import { workspaceNodeId } from '../workspace-canvas-node-ids'
import type {
  WorkspaceCanvasStreamKind,
  WorkspaceCanvasStreamPatch,
  WorkspaceCanvasStreamPatchData,
  WorkspaceCanvasStreamTarget,
} from './workspace-structured-stream-runtime-types'
import { areAllTerminalHandoffs } from './workspace-structured-stream-handoff'

type TranslateValues = Readonly<Record<string, string | number>>
export type WorkspaceStructuredStreamTranslate = (key: string, values?: TranslateValues) => string

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
  translate: WorkspaceStructuredStreamTranslate,
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
  readonly translate: WorkspaceStructuredStreamTranslate
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
  translate: WorkspaceStructuredStreamTranslate,
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
  translate: WorkspaceStructuredStreamTranslate,
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
  translate: WorkspaceStructuredStreamTranslate,
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

function buildShotExecutionRuntimeEntries(
  snapshots: readonly StructuredStreamSnapshot[],
  translate: WorkspaceStructuredStreamTranslate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  const matchingSnapshots = snapshots.filter((snapshot) => snapshot.adapterKey === 'shotExecutionPlan.shots')
  const grouped = new Map<string, StructuredStreamSnapshot[]>()
  matchingSnapshots.forEach((snapshot) => {
    if (!snapshot.targetId) return
    const key = `${snapshot.taskId}:${snapshot.targetId}`
    grouped.set(key, [...(grouped.get(key) ?? []), snapshot])
  })
  return [...grouped.values()].flatMap((group) => {
    const firstSnapshot = group[0] ?? null
    if (!firstSnapshot?.targetId) return []
    const shotItems = itemsOfKind(group, 'shotExecutionPlan.shots', 'shotExecutionPlanShot')
    if (shotItems.length === 0) return []
    const rawItems = group.flatMap((snapshot) => snapshot.items)
    return [createStreamRuntimeEntry({
      nodeId: workspaceNodeId.editShotExecutionPlan(firstSnapshot.targetId),
      streamKind: 'editShotExecutionPlan',
      taskId: firstSnapshot.taskId,
      taskType: firstSnapshot.taskType,
      targetType: firstSnapshot.targetType,
      targetId: firstSnapshot.targetId,
      episodeId: firstSnapshot.episodeId,
      terminalHandoff: areAllTerminalHandoffs(group),
      presentation: streamPresentation(rawItems),
      data: {
        body: translate('nodes.editShotExecutionPlan.pendingBody'),
        meta: translate('nodes.editShotExecutionPlan.meta', { shots: shotItems.length }),
        editPipelineStepDetails: {
          items: pipelineItemsFromShotExecutionPlan(shotItems, translate),
        },
      },
    })]
  })
}

function buildBgmRuntimeEntry(
  snapshots: readonly StructuredStreamSnapshot[],
  episodeId: string,
  translate: WorkspaceStructuredStreamTranslate,
): WorkspaceCanvasStreamRuntimeEntry | null {
  const cues = itemsOfKind(snapshots, 'bgmDesign.scoreCue', 'bgmDesignScoreCue').map((item) => item.cue)
  const rawItems = snapshots
    .filter((snapshot) => snapshot.adapterKey === 'bgmDesign.scoreCue')
    .flatMap((snapshot) => snapshot.items)
  if (cues.length === 0) return null
  const firstSnapshot = snapshots.find((snapshot) => snapshot.adapterKey === 'bgmDesign.scoreCue') ?? null
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
      snapshots.filter((snapshot) => snapshot.adapterKey === 'bgmDesign.scoreCue'),
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

export function buildStreamRuntimeEntries(
  snapshots: readonly StructuredStreamSnapshot[],
  episodeId: string,
  translate: WorkspaceStructuredStreamTranslate,
): readonly WorkspaceCanvasStreamRuntimeEntry[] {
  return [
    ...buildSourceScriptRuntimeEntries(snapshots, translate),
    ...buildProductionPlanningRuntimeEntries(snapshots, translate),
    ...buildEditScriptRuntimeEntries(snapshots, episodeId, translate),
    ...buildShotExecutionRuntimeEntries(snapshots, translate),
    buildBgmRuntimeEntry(snapshots, episodeId, translate),
  ].filter((entry): entry is WorkspaceCanvasStreamRuntimeEntry => entry !== null)
}
