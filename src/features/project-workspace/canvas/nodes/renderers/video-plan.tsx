'use client'

import React, { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { CanvasActionButton } from '../CanvasActionButton'
import type { WorkspaceCanvasFlowNode } from '../../node-canvas-types'
import {
  SELECTABLE_TEXT_CLASS,
  dispatchNodeAction,
  nodeContentInteractionClass,
  renderSection,
  renderTextBlock,
  renderValue,
  videoElementAspectRatio,
} from './renderer-shared'

export function VideoPlanContent({
  data,
  labels,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.videoPlanDetails
  const displayOutputUrl = toDisplayImageUrl(details?.outputUrl) ?? details?.outputUrl ?? null
  const [intrinsicAspectRatio, setIntrinsicAspectRatio] = useState<number | null>(null)
  useEffect(() => setIntrinsicAspectRatio(null), [displayOutputUrl])
  if (!details) {
    return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  }
  const aspectRatio = intrinsicAspectRatio ?? details.outputAspectRatio ?? 16 / 9
  const action = data.action?.type === 'generate_video_segments' ? data.action : null
  return (
    <div className={nodeContentInteractionClass(data, 'space-y-3')}>
      {displayOutputUrl ? (
        <div className="nodrag nowheel relative flex w-full items-center justify-center overflow-hidden rounded-[16px] bg-black" style={{ aspectRatio }}>
          <video
            src={displayOutputUrl}
            aria-label={data.title}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => {
              const next = videoElementAspectRatio(event.currentTarget)
              if (next !== null) setIntrinsicAspectRatio(next)
            }}
            className="h-full w-full object-contain"
          />
        </div>
      ) : (
        <div className="flex w-full items-center justify-center rounded-[16px] bg-slate-50 px-4 py-10 text-center text-xs text-slate-500 ring-1 ring-slate-200">
          {details.continuity}
        </div>
      )}
      {action && data.onAction ? (
        <CanvasActionButton
          action={action}
          nodeId={data.nodeId ?? data.targetId}
          type="button"
          icon="video"
          label={data.actionLabel ?? labels(displayOutputUrl ? 'regenerateVideo' : 'generateVideo')}
          className="w-full rounded-md"
          onDirectAction={() => dispatchNodeAction(data, action)}
        />
      ) : null}
      {renderSection(
        labels('videoPlanMeta'),
        <div className="space-y-1">
          {renderValue(labels('duration'), `${details.durationSec}s`)}
          {renderValue(labels('linkedShots'), details.shotNumbers.join(', '))}
          {renderValue(labels('continuity'), details.continuity)}
        </div>,
      )}
      {details.errorMessage ? renderSection(labels('error'), renderTextBlock(details.errorMessage)) : null}
    </div>
  )
}
