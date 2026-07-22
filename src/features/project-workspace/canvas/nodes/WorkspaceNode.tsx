'use client'

import { useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { EstimatedTaskProgressInline } from '@/components/task/EstimatedTaskProgressOverlay'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon } from '@/components/ui/icons'
import {
  workspaceCanvasLifecycleStatusKey,
  workspaceCanvasLifecycleTaskState,
} from '../lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import { getWorkspaceCanvasNodePresentationProfile } from '../node-presentation-profiles'
import { getWorkspaceCanvasNodeDefinition } from '../registry/workspace-canvas-node-registry'
import {
  LoadingSpinner,
  SELECTABLE_TEXT_CLASS,
  WorkspaceNodeImagePreviewContext,
  nodeIsRunning,
} from './renderers/renderer-shared'
import { NodeContent } from './workspace-node-renderer-registry'

export default function WorkspaceNode({ data }: NodeProps<WorkspaceCanvasFlowNode>) {
  const labels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  const statusLabels = useTranslations('projectWorkflow.canvas.workspace.status')
  const expanded = data.disclosure?.effectiveExpanded ?? data.expanded === true
  const nodeDefinition = getWorkspaceCanvasNodeDefinition(data.kind)
  const presentation = nodeDefinition.presentation
  const isRunning = nodeIsRunning(data)
  const showDetailsToggle = data.disclosure?.canToggle === true && Boolean(data.onToggleExpanded)
  const fixedExpandedShell = expanded && Boolean(getWorkspaceCanvasNodePresentationProfile(data.kind).expanded)
  const usesGridAutoHeightShell = presentation.usesGridAutoHeightShell
  const shellLayoutClass = usesGridAutoHeightShell
    ? 'overflow-hidden'
    : fixedExpandedShell
      ? 'min-h-full overflow-visible'
      : 'overflow-visible'
  const isFocusHighlighted = data.focusHighlighted === true
  const isVisuallyEmphasized = isRunning || isFocusHighlighted
  const statusLabel = statusLabels(workspaceCanvasLifecycleStatusKey(data.lifecycle))
  const shouldShowFooter =
    showDetailsToggle ||
    presentation.showsMetaFooter
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)

  return (
    <WorkspaceNodeImagePreviewContext.Provider value={setPreviewImageUrl}>
      <div className={`relative overflow-visible ${usesGridAutoHeightShell ? 'h-auto' : 'h-full'}`}>
        <Handle
          type="target"
          position={Position.Left}
          className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm"
        />
        {presentation.hasSourceHandle ? (
          <Handle
            type="source"
            position={Position.Right}
            className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm"
          />
        ) : null}

        <article
          className={`workspace-canvas-node-shell relative ${shellLayoutClass} rounded-[24px] border bg-white/92 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-xl ${isVisuallyEmphasized ? 'workspace-node-running-breathing border-sky-300' : 'border-slate-200'}`}
          data-node-id={data.nodeId}
          data-lifecycle-phase={data.lifecycle.phase}
          data-lifecycle-task-id={data.lifecycle.taskId ?? ''}
          data-disclosure-mode={data.disclosure?.mode ?? 'none'}
          data-expanded={expanded ? 'true' : 'false'}
        >
          <div>
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--glass-text-tertiary)]">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-[11px] bg-slate-100 text-[var(--glass-text-secondary)]">
                    <AppIcon name={presentation.iconName} className="h-4 w-4" />
                  </span>
                  <p className={`${SELECTABLE_TEXT_CLASS} truncate`}>{data.eyebrow}</p>
                </div>
                {presentation.showsLargeTitle ? (
                  <h2
                    className={`${SELECTABLE_TEXT_CLASS} mt-2 truncate text-xl font-semibold tracking-tight text-[var(--glass-text-primary)]`}
                  >
                    {data.title}
                  </h2>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`${SELECTABLE_TEXT_CLASS} inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${isRunning ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-[var(--glass-text-secondary)]'}`}
                >
                  {isRunning ? <LoadingSpinner /> : null}
                  {statusLabel}
                </span>
              </div>
            </header>

            <div
              className={`workspace-canvas-node-content space-y-4 px-5 py-5 ${isRunning ? 'opacity-90' : ''}`}
              data-expanded={expanded ? 'true' : 'false'}
            >
              <NodeContent data={data} labels={labels} expanded={expanded} />
              {presentation.usesInlineTaskProgress ? (
                <EstimatedTaskProgressInline taskState={workspaceCanvasLifecycleTaskState(data.lifecycle)} />
              ) : null}

              {shouldShowFooter ? (
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <div className="min-w-0">
                    <p className={`${SELECTABLE_TEXT_CLASS} truncate text-xs text-[var(--glass-text-tertiary)]`}>
                      {presentation.showsMetaText ? data.meta : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {showDetailsToggle ? (
                      <button
                        type="button"
                        className="nodrag inline-flex items-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-[var(--glass-text-secondary)] transition hover:bg-slate-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.currentTarget.blur()
                          if (data.nodeId) data.onToggleExpanded?.(data.nodeId)
                        }}
                      >
                        {expanded ? labels('collapseDetails') : labels('expandDetails')}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </article>
      </div>
      {previewImageUrl ? (
        <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      ) : null}
    </WorkspaceNodeImagePreviewContext.Provider>
  )
}
