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
          className={`workspace-canvas-node-shell relative h-full overflow-visible rounded-[24px] border bg-white/92 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-xl ${isRunning ? 'workspace-node-running-breathing border-sky-300' : 'border-slate-200'}`}
          data-node-id={data.nodeId}
          data-lifecycle-phase={data.lifecycle.phase}
          data-lifecycle-task-id={data.lifecycle.taskId ?? ''}
        >
          <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--glass-text-tertiary)]">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-[11px] bg-slate-100 text-[var(--glass-text-secondary)]">
                  <AppIcon name={presentation.iconName} className="h-4 w-4" />
                </span>
                <p className={`${SELECTABLE_TEXT_CLASS} truncate`}>{data.eyebrow}</p>
              </div>
              <h2
                className={`${SELECTABLE_TEXT_CLASS} mt-2 truncate text-base font-semibold tracking-tight text-[var(--glass-text-primary)]`}
              >
                {data.title}
              </h2>
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

          <div className="workspace-canvas-node-content px-5 py-5">
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
