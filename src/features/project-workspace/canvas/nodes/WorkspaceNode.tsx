'use client'

import { useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslations } from 'next-intl'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon } from '@/components/ui/icons'
import { workspaceCanvasLifecycleStatusKey } from '../lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
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
  const nodeDefinition = getWorkspaceCanvasNodeDefinition(data.kind)
  const presentation = nodeDefinition.presentation
  const isRunning = nodeIsRunning(data)
  const statusLabel = statusLabels(workspaceCanvasLifecycleStatusKey(data.lifecycle))
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)

  return (
    <WorkspaceNodeImagePreviewContext.Provider value={setPreviewImageUrl}>
      <div className="relative h-full overflow-visible">
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
          className={`workspace-canvas-node-shell relative h-full overflow-visible rounded-[18px] border bg-white/92 shadow-[0_12px_36px_rgba(15,23,42,0.07)] backdrop-blur-xl transition-shadow ${
            data.uiSelected
              ? 'border-sky-400 ring-2 ring-sky-400/45'
              : isRunning
                ? 'workspace-node-running-breathing border-sky-300'
                : 'border-slate-200/80'
          }`}
          data-node-id={data.nodeId}
          data-lifecycle-phase={data.lifecycle.phase}
          data-lifecycle-task-id={data.lifecycle.taskId ?? ''}
        >
          <header className="flex min-h-[24px] items-center gap-2 px-3.5 pb-1.5 pt-2.5">
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] bg-slate-100 text-[var(--glass-text-tertiary)]"
              title={data.eyebrow}
            >
              <AppIcon name={presentation.iconName} className="h-3 w-3" />
            </span>
            <h2
              className={`${SELECTABLE_TEXT_CLASS} min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-[var(--glass-text-primary)]`}
            >
              {data.title}
            </h2>
            {data.lifecycle.phase !== 'succeeded' ? (
              <span
                className={`${SELECTABLE_TEXT_CLASS} inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  isRunning
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : data.lifecycle.phase === 'failed'
                      ? 'border-red-200 bg-red-50 text-[var(--glass-tone-danger-fg)]'
                      : 'border-slate-200 bg-white text-[var(--glass-text-secondary)]'
                }`}
              >
                {isRunning ? <LoadingSpinner /> : null}
                {statusLabel}
              </span>
            ) : null}
          </header>

          <div className="workspace-canvas-node-content px-3.5 pb-3.5 pt-0.5">
            <NodeContent data={data} labels={labels} />
          </div>
        </article>
      </div>
      {previewImageUrl ? (
        <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      ) : null}
    </WorkspaceNodeImagePreviewContext.Provider>
  )
}
