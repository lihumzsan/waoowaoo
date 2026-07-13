'use client'

import { useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { EstimatedTaskProgressInline } from '@/components/task/EstimatedTaskProgressOverlay'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import {
  workspaceCanvasLifecycleStatusKey,
  workspaceCanvasLifecycleTaskState,
} from '../lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import { getWorkspaceCanvasNodePresentationProfile } from '../node-presentation-profiles'
import {
  LoadingSpinner,
  SELECTABLE_TEXT_CLASS,
  WorkspaceNodeImagePreviewContext,
  nodeActionIconName,
  nodeIconName,
  nodeIsRunning,
  nodeShowsMetaFooter,
} from './WorkspaceNodeRenderers'
import { NodeContent } from './workspace-node-renderer-registry'
import { CanvasActionButton } from './CanvasActionButton'

function nodeUsesInlineTaskProgress(kind: WorkspaceCanvasFlowNode['data']['kind']): boolean {
  return kind === 'videoPlan' || kind === 'bgmScore' || kind === 'soundscape' || kind === 'finalTimeline'
}

export default function WorkspaceNode({ data }: NodeProps<WorkspaceCanvasFlowNode>) {
  const labels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  const statusLabels = useTranslations('projectWorkflow.canvas.workspace.status')
  const expanded = data.disclosure?.effectiveExpanded ?? (data.expanded === true)
  const hasSource = data.kind !== 'finalTimeline'
  const action = data.action
  const isRunning = nodeIsRunning(data)
  const secondaryAction = data.secondaryAction
  const tertiaryAction = data.tertiaryAction
  const secondaryActionIcon: AppIconName = secondaryAction
    ? nodeActionIconName(secondaryAction)
    : 'externalLink'
  const tertiaryActionIcon: AppIconName = tertiaryAction
    ? nodeActionIconName(tertiaryAction)
    : 'externalLink'
  const showDetailsToggle = data.disclosure?.canToggle === true && Boolean(data.onToggleExpanded)
  const showHeaderAction = Boolean(action && data.actionLabel && data.kind === 'editRequiredAsset')
  const showLargeTitle = data.kind !== 'shot'
  const fixedExpandedShell = expanded && Boolean(getWorkspaceCanvasNodePresentationProfile(data.kind).expanded)
  const usesGridAutoHeightShell = data.kind === 'editScript' || data.kind === 'editSourceScript' || data.kind === 'editBible'
  const shellLayoutClass = usesGridAutoHeightShell
    ? 'overflow-hidden'
    : fixedExpandedShell
      ? 'min-h-full overflow-visible'
      : 'overflow-visible'
  const isFocusHighlighted = data.focusHighlighted === true
  const isVisuallyEmphasized = isRunning || isFocusHighlighted
  const statusLabel = statusLabels(workspaceCanvasLifecycleStatusKey(data.lifecycle))
  const shouldShowFooter = (
    showDetailsToggle
    || Boolean(action && data.actionLabel && !showHeaderAction)
    || Boolean(secondaryAction && data.secondaryActionLabel)
    || Boolean(tertiaryAction && data.tertiaryActionLabel)
    || nodeShowsMetaFooter(data.kind)
  )
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)

  return (
    <WorkspaceNodeImagePreviewContext.Provider value={setPreviewImageUrl}>
      <div className={`relative overflow-visible ${usesGridAutoHeightShell ? 'h-auto' : 'h-full'}`}>
        <Handle type="target" position={Position.Left} className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm" />
        {hasSource ? <Handle type="source" position={Position.Right} className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm" /> : null}

        <article
          className={`workspace-canvas-node-shell relative ${shellLayoutClass} rounded-[24px] border bg-white/92 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-xl ${isVisuallyEmphasized ? 'workspace-node-running-breathing border-sky-300' : 'border-slate-200'}`}
          data-node-id={data.nodeId}
          data-lifecycle-phase={data.lifecycle.phase}
          data-lifecycle-task-id={data.lifecycle.taskId ?? ''}
          data-terminal-handoff-task-id={data.terminalHandoffTaskId ?? ''}
          data-stream-presentation={data.lifecycle.stream
            ? data.lifecycle.stream.isStreaming ? 'active' : 'handoff'
            : 'none'}
          data-disclosure-mode={data.disclosure?.mode ?? 'none'}
          data-expanded={expanded ? 'true' : 'false'}
        >
          <div>
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--glass-text-tertiary)]">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-[11px] bg-slate-100 text-[var(--glass-text-secondary)]">
                    <AppIcon name={nodeIconName(data.kind)} className="h-4 w-4" />
                  </span>
                  {data.indexLabel ? (
                    <span className={`${SELECTABLE_TEXT_CLASS} inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-[11px] font-semibold text-[var(--glass-text-secondary)]`}>
                      {data.indexLabel}
                    </span>
                  ) : null}
                  <p className={`${SELECTABLE_TEXT_CLASS} truncate`}>{data.eyebrow}</p>
                </div>
                {showLargeTitle ? (
                  <h2 className={`${SELECTABLE_TEXT_CLASS} mt-2 truncate text-xl font-semibold tracking-tight text-[var(--glass-text-primary)]`}>{data.title}</h2>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {showHeaderAction && action && data.actionLabel ? (
                  <CanvasActionButton
                    action={action}
                    nodeId={data.nodeId ?? data.targetId}
                    type="button"
                    icon={nodeActionIconName(action)}
                    label={data.actionLabel}
                    className="py-2"
                    disabled={data.actionDisabled === true || isRunning}
                    onDirectAction={() => {
                      if (!isRunning) data.onAction?.(action, data.nodeId)
                    }}
                  />
                ) : null}
                <span className={`${SELECTABLE_TEXT_CLASS} inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${isRunning ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-[var(--glass-text-secondary)]'}`}>
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
              {nodeUsesInlineTaskProgress(data.kind) ? (
                <EstimatedTaskProgressInline taskState={workspaceCanvasLifecycleTaskState(data.lifecycle)} />
              ) : null}

              {shouldShowFooter ? (
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <div className="min-w-0">
                    <p className={`${SELECTABLE_TEXT_CLASS} truncate text-xs text-[var(--glass-text-tertiary)]`}>
                      {data.kind === 'editRequiredAsset' ? '' : data.meta}
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
                    {action && data.actionLabel && !showHeaderAction ? (
                      <CanvasActionButton
                        action={action}
                        nodeId={data.nodeId ?? data.targetId}
                        type="button"
                        icon={nodeActionIconName(action)}
                        label={data.actionLabel}
                        loading={isRunning}
                        disabled={data.actionDisabled === true || isRunning}
                        onDirectAction={() => {
                          if (!isRunning) data.onAction?.(action, data.nodeId)
                        }}
                      />
                    ) : null}
                    {secondaryAction && data.secondaryActionLabel ? (
                      <CanvasActionButton
                        action={secondaryAction}
                        nodeId={data.nodeId ?? data.targetId}
                        type="button"
                        tone="secondary"
                        icon={secondaryActionIcon}
                        label={data.secondaryActionLabel}
                        disabled={data.actionDisabled === true || isRunning}
                        onDirectAction={() => {
                          if (!isRunning) data.onAction?.(secondaryAction, data.nodeId)
                        }}
                      />
                    ) : null}
                    {tertiaryAction && data.tertiaryActionLabel ? (
                      <CanvasActionButton
                        action={tertiaryAction}
                        nodeId={data.nodeId ?? data.targetId}
                        type="button"
                        tone="secondary"
                        icon={tertiaryActionIcon}
                        label={data.tertiaryActionLabel}
                        disabled={data.actionDisabled === true || isRunning}
                        onDirectAction={() => {
                          if (!isRunning) data.onAction?.(tertiaryAction, data.nodeId)
                        }}
                      />
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
