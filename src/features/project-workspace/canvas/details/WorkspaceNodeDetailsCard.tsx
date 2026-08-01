'use client'

import { useState } from 'react'
import { ViewportPortal } from '@xyflow/react'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import { WorkspaceNodeImagePreviewContext } from '../nodes/renderers/renderer-shared'
import { WorkspaceNodeDetailsPanel } from './WorkspaceNodeDetailsPanel'
import type { WorkspaceCanvasResourceOperationView } from '../contracts/workspace-canvas-interactions'

const DETAILS_CARD_GAP = 16
/**
 * The card is deliberately wider than a node: input references pack
 * horizontally and the prompt gets long lines, so the same content needs far
 * less vertical space than the node-width column it replaced.
 */
const DETAILS_CARD_MIN_WIDTH = 720

/**
 * The detail card for the selected Canvas node, rendered in the ReactFlow
 * viewport layer directly below the node so it follows canvas pan/zoom.
 * It only consumes the card View (prompt provenance + resolved input
 * summaries); it never fetches by raw resource ID.
 */
export interface WorkspaceNodeDetailsActions {
  readonly busy: boolean
  readonly hidden: boolean
  readonly onAssistantPrefill: (text: string | null) => void
  readonly onPreview: () => void
  readonly onOperation: (operation: WorkspaceCanvasResourceOperationView) => void
  readonly onSetArchived: (archived: boolean) => void
  readonly onVisibilityChange: (hidden: boolean) => void
}

export function WorkspaceNodeDetailsCard({
  node,
  actions,
}: {
  readonly node: WorkspaceCanvasFlowNode
  readonly actions: WorkspaceNodeDetailsActions
}) {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const resource = node.data.resourceDetails.resource
  const prompt = resource.materialization?.provenance.prompt
    ?? resource.pendingGeneration?.prompt
    ?? null
  const modelKey = resource.materialization?.provenance.modelKey
    ?? resource.pendingGeneration?.modelKey
    ?? null
  const inputs = node.data.resourceDetails.inputSummaries
  const width = Math.max(node.data.width, DETAILS_CARD_MIN_WIDTH)

  return (
    <WorkspaceNodeImagePreviewContext.Provider value={setPreviewImageUrl}>
      <ViewportPortal>
        <div
          className="nodrag nopan pointer-events-auto absolute"
          style={{
            transform: `translate(${node.position.x - (width - node.data.width) / 2}px, ${node.position.y + node.data.height + DETAILS_CARD_GAP}px)`,
            width,
            zIndex: 40,
          }}
          data-node-details-for={node.id}
          onClick={(event) => event.stopPropagation()}
          onMouseDownCapture={(event) => event.stopPropagation()}
        >
          <WorkspaceNodeDetailsPanel
            card={node.data.resourceDetails}
            prompt={prompt}
            modelKey={modelKey}
            inputs={inputs}
            actions={actions}
          />
        </div>
      </ViewportPortal>
      {previewImageUrl ? (
        <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      ) : null}
    </WorkspaceNodeImagePreviewContext.Provider>
  )
}
