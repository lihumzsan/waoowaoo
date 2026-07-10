import type { TaskRuntimeStateLike } from '@/lib/task/runtime-targets'
import { taskRuntimeTargetQueryKey } from '@/lib/task/runtime-targets'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import type { WorkspaceCanvasStreamPatch } from '@/features/project-workspace/canvas/structured-stream/workspace-structured-stream-runtime-types'
import { resolveWorkspaceCanvasNodeData } from '@/features/project-workspace/canvas/workspace-node-runtime'
import {
  assertHistoricalValue,
  proveSemanticFaultRejected,
  type HistoricalRegressionScenario,
} from '../../harness/historical-regression'
import { runLifecycleSequence } from '../../harness/lifecycle-sequence'

const runtimeTarget = {
  targetType: 'ProjectEditSourceScript',
  targetId: 'source-1',
  types: ['edit_source_script_generate'],
} as const

type CanvasFacts = {
  readonly persisted: 'pending' | 'succeeded'
  readonly task: 'processing' | 'completed'
  readonly stream: boolean
}

type CanvasExpected = {
  readonly phase: string
  readonly body: string
  readonly errorCode: string | null
}

function sourceNode(persisted: CanvasFacts['persisted']): WorkspaceCanvasFlowNode {
  return {
    id: 'edit-source-script:episode:episode-1',
    type: 'workspaceNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 'editSourceScript', mediaLoadingContext: null, layoutNodeType: 'editSourceScript',
      targetType: 'editSourceScript', targetId: 'source-1', title: 'Source', eyebrow: 'Source',
      body: 'persisted source', meta: '', runtimeTargets: [runtimeTarget], width: 760, height: 360,
      lifecycle: { phase: persisted, taskId: null, taskType: null, progress: null, error: null, stream: null },
      sourceScriptDetails: { sourceText: 'persisted source', scriptStructure: null },
    },
  }
}

function taskState(phase: CanvasFacts['task']): TaskRuntimeStateLike {
  return phase === 'processing'
    ? { phase, taskId: 'task-1', runningTaskId: 'task-1', runningTaskType: 'edit_source_script_generate' }
    : { phase, taskId: 'task-1', runningTaskId: null, runningTaskType: 'edit_source_script_generate' }
}

function streamPatch(): WorkspaceCanvasStreamPatch {
  return {
    nodeId: 'edit-source-script:episode:episode-1', streamKind: 'editSourceScript',
    taskId: 'task-1', taskType: 'edit_source_script_generate',
    presentation: {
      isStreaming: true, activeItemKey: 'scene-1', displayedItemKeys: ['scene-1'],
      pinnedItemKeys: [], revealedFieldCountByKey: {},
    },
    error: null,
    data: { body: 'streamed source', sourceScriptDetails: { sourceText: 'streamed source', scriptStructure: null } },
  }
}

function resolveCanvas(facts: CanvasFacts): CanvasExpected {
  const resolved = resolveWorkspaceCanvasNodeData({
    node: sourceNode(facts.persisted),
    statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), taskState(facts.task)]]),
    streamPatch: facts.stream ? streamPatch() : null,
    submitting: false,
  })
  return {
    phase: resolved.lifecycle.phase,
    body: resolved.body,
    errorCode: resolved.lifecycle.error?.code ?? null,
  }
}

function canvasScenario(
  id: string,
  steps: readonly { readonly id: string; readonly facts: CanvasFacts; readonly expected: CanvasExpected }[],
  fault: (facts: CanvasFacts) => CanvasExpected,
): HistoricalRegressionScenario {
  const run = (resolve: (facts: CanvasFacts) => CanvasExpected, recordExecution: (id: string) => void) => {
    runLifecycleSequence({
      scenarioId: id,
      steps,
      resolve,
      assertStep({ stepId, view, expected }) {
        assertHistoricalValue(view, expected, `${id}:${stepId}`)
      },
    }, { recordExecution })
  }
  return {
    id, identity: id, defectId: 'BUG-CN-001', severity: 'P0',
    invariantIds: ['CN-02', 'CN-04', 'CN-07', 'CN-08'],
    historicalDefectIds: ['BUG-CN-001'], layers: ['regression'],
    async execute(context) { run(resolveCanvas, context.recordExecution) },
    async verifyFailBefore() {
      await proveSemanticFaultRejected(() => run(fault, () => undefined))
    },
  }
}

const terminalExpected = { phase: 'succeeded', body: 'persisted source', errorCode: null }

export const CANVAS_LIFECYCLE_HISTORICAL_SCENARIOS: readonly HistoricalRegressionScenario[] = [
  canvasScenario('SCENARIO-CANVAS-MATERIALIZE-BEFORE-TERMINAL', [
    { id: 'streaming', facts: { persisted: 'pending', task: 'processing', stream: true }, expected: { phase: 'streaming', body: 'streamed source', errorCode: null } },
    { id: 'materialized-terminal', facts: { persisted: 'succeeded', task: 'completed', stream: true }, expected: terminalExpected },
  ], (facts) => facts.task === 'completed'
    ? { phase: 'pending', body: '', errorCode: null }
    : resolveCanvas(facts)),
  canvasScenario('SCENARIO-CANVAS-REPLAY-DUPLICATE', [
    { id: 'terminal', facts: { persisted: 'succeeded', task: 'completed', stream: false }, expected: terminalExpected },
    { id: 'duplicate-terminal', facts: { persisted: 'succeeded', task: 'completed', stream: false }, expected: terminalExpected },
  ], (facts) => facts.stream ? resolveCanvas(facts) : { phase: 'pending', body: '', errorCode: null }),
  canvasScenario('SCENARIO-CANVAS-LATE-STREAM-AFTER-TERMINAL', [
    { id: 'late-stream', facts: { persisted: 'succeeded', task: 'completed', stream: true }, expected: terminalExpected },
  ], () => ({ phase: 'streaming', body: 'streamed source', errorCode: null })),
]
