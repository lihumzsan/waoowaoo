'use client'

import { useState } from 'react'
import { ViewportPortal } from '@xyflow/react'
import { useTranslations } from 'next-intl'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon } from '@/components/ui/icons'
import type { CreativeResourceInputSummaryView } from '@/lib/creative-resource/contracts'
import { workspaceCanvasScrollableRegionProps } from '../canvas-scroll-lock'
import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import {
  PreviewableImage,
  SELECTABLE_TEXT_CLASS,
  WorkspaceNodeImagePreviewContext,
  renderSection,
} from '../nodes/renderers/renderer-shared'

const DETAILS_CARD_GAP = 16
const DETAILS_CARD_MIN_WIDTH = 320

function InputMediaPreview({ input }: { readonly input: CreativeResourceInputSummaryView }) {
  if (!input.media) {
    return (
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[var(--glass-text-tertiary)]">
        <AppIcon name="file" className="h-5 w-5" />
      </span>
    )
  }
  if (input.mediaType === 'image') {
    return (
      <PreviewableImage
        sourceImageUrl={input.media.url}
        alt={input.name}
        buttonClassName="h-12 w-12 shrink-0"
        imageClassName="h-12 w-12 rounded-xl bg-slate-100 object-cover"
      />
    )
  }
  if (input.mediaType === 'video') {
    return (
      <video
        src={input.media.url}
        aria-label={input.name}
        controls
        preload="metadata"
        className="nodrag nowheel h-16 w-28 shrink-0 rounded-xl bg-black object-contain"
      />
    )
  }
  if (input.mediaType === 'audio') {
    return (
      <audio
        src={input.media.url}
        aria-label={input.name}
        controls
        preload="metadata"
        className="nodrag nowheel h-10 w-full min-w-0"
      />
    )
  }
  return null
}

function InputSummaryRow({
  input,
  mediaTypeLabel,
}: {
  readonly input: CreativeResourceInputSummaryView
  readonly mediaTypeLabel: string
}) {
  return (
    <li className="flex items-center gap-3 rounded-[14px] border border-slate-100 bg-white p-2.5">
      <InputMediaPreview input={input} />
      <div className="min-w-0 flex-1">
        <p className={`${SELECTABLE_TEXT_CLASS} truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>
          {input.name}
        </p>
        <p className={`${SELECTABLE_TEXT_CLASS} mt-0.5 text-[11px] text-[var(--glass-text-tertiary)]`}>
          {mediaTypeLabel}
        </p>
      </div>
    </li>
  )
}

/**
 * The detail card for the selected Canvas node, rendered in the ReactFlow
 * viewport layer directly below the node so it follows canvas pan/zoom.
 * It only consumes the card View (prompt provenance + resolved input
 * summaries); it never fetches by raw resource ID.
 */
export function WorkspaceNodeDetailsCard({ node }: { readonly node: WorkspaceCanvasFlowNode }) {
  const t = useTranslations('projectWorkflow.canvas.workspace.details')
  const labels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  const mediaTypeLabels = useTranslations('projectWorkflow.canvas.workspace.nodes.resourceCard.mediaType')
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
            transform: `translate(${node.position.x}px, ${node.position.y + node.data.height + DETAILS_CARD_GAP}px)`,
            width,
            zIndex: 40,
          }}
          data-node-details-for={node.id}
          onClick={(event) => event.stopPropagation()}
          onMouseDownCapture={(event) => event.stopPropagation()}
        >
          <section className="space-y-3 rounded-[20px] border border-slate-200 bg-white/96 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.14)] backdrop-blur-xl">
            {prompt
              ? renderSection(labels('generationPrompt'), (
                  <div
                    {...workspaceCanvasScrollableRegionProps<HTMLDivElement>()}
                    className="nowheel max-h-56 overflow-y-auto"
                  >
                    <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words text-xs leading-5 text-slate-700`}>
                      {prompt}
                    </p>
                  </div>
                ))
              : null}
            {modelKey
              ? renderSection(labels('generationModel'), (
                  <p className={`${SELECTABLE_TEXT_CLASS} break-all text-xs text-slate-700`}>{modelKey}</p>
                ))
              : null}
            {inputs.length > 0
              ? renderSection(labels('generationReferences'), (
                  <ul className="space-y-2">
                    {inputs.map((input) => (
                      <InputSummaryRow
                        key={`${input.role}:${String(input.position)}:${input.resourceId}`}
                        input={input}
                        mediaTypeLabel={mediaTypeLabels(input.mediaType)}
                      />
                    ))}
                  </ul>
                ))
              : null}
            {!prompt && !modelKey && inputs.length === 0 ? (
              <p className={`${SELECTABLE_TEXT_CLASS} px-1 py-2 text-xs text-[var(--glass-text-tertiary)]`}>
                {t('empty')}
              </p>
            ) : null}
          </section>
        </div>
      </ViewportPortal>
      {previewImageUrl ? (
        <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      ) : null}
    </WorkspaceNodeImagePreviewContext.Provider>
  )
}
