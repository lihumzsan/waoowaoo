'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { MediaGenerationLoadingView } from '@/components/media/MediaGenerationLoading'
import { AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { useEstimatedTaskProgress } from '@/lib/query/hooks/useEstimatedTaskProgress'
import type { WorkspaceCanvasLifecycle } from '../lifecycle/workspace-canvas-lifecycle'
import {
  isWorkspaceCanvasLifecycleRunning,
  workspaceCanvasLifecycleTaskState,
} from '../lifecycle/workspace-canvas-lifecycle'
import { resolveCanvasMediaSurfacePhase } from './canvas-media-generation-view'

interface CanvasMediaGenerationSurfaceProps {
  readonly lifecycle: WorkspaceCanvasLifecycle
  readonly hasOutput: boolean
  readonly outputImageUrl?: string | null
  readonly styleImageUrl: string | null
  readonly placeholder: ReactNode
  readonly ringSize: number
}

export function CanvasMediaGenerationSurface({
  lifecycle,
  hasOutput,
  outputImageUrl,
  styleImageUrl,
  placeholder,
  ringSize,
}: CanvasMediaGenerationSurfaceProps) {
  const labels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  const taskState = workspaceCanvasLifecycleTaskState(lifecycle)
  const progress = useEstimatedTaskProgress(taskState)
  const phase = resolveCanvasMediaSurfacePhase({
    lifecyclePhase: lifecycle.phase,
    hasOutput,
  })
  const displayStyleImageUrl = toDisplayImageUrl(styleImageUrl)
  const displayOutputImageUrl = toDisplayImageUrl(outputImageUrl)
  const running = isWorkspaceCanvasLifecycleRunning(lifecycle)
  const failed = phase === 'failed-empty' || phase === 'failed-existing'
  const needsEmptyBackground = !hasOutput
  const showPlaceholder = phase === 'empty'
  const showContractError = phase === 'contract-error'
  const backgroundKind = hasOutput
    ? 'output'
    : displayStyleImageUrl
      ? 'style-bible'
      : showContractError
        ? 'contract-error'
        : 'neutral'

  if (phase === 'ready') return null

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      data-canvas-media-surface="true"
      data-canvas-media-phase={phase}
      data-canvas-media-background={backgroundKind}
      data-canvas-media-placeholder-visible={showPlaceholder ? 'true' : 'false'}
    >
      {needsEmptyBackground ? (
        displayStyleImageUrl ? (
          <>
            <div
              className="absolute inset-0 scale-110"
              style={{
                backgroundImage: `url("${displayStyleImageUrl}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(18px)',
              }}
            />
            <div className="absolute inset-0 bg-white/45 backdrop-blur-xl" />
          </>
        ) : (
          <div className={`absolute inset-0 ${showContractError ? 'bg-[var(--glass-tone-danger-bg)]' : 'bg-[var(--glass-bg-muted)]'}`} />
        )
      ) : running || failed ? (
        <div className="absolute inset-0 bg-[rgba(10,16,30,0.28)]" />
      ) : null}

      {showPlaceholder ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          {placeholder}
        </div>
      ) : null}

      {showContractError ? (
        <div className="absolute inset-x-4 top-4 z-10 flex items-center justify-center gap-2 rounded-[12px] border border-[var(--glass-tone-danger-ring)] bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-center text-xs font-semibold text-[var(--glass-tone-danger-fg)]">
          <AppIcon name="alertSolid" className="h-4 w-4 shrink-0" />
          <span>{labels('mediaOutputMissing')}</span>
        </div>
      ) : null}

      {running || failed ? (
        <MediaGenerationLoadingView
          mode={failed ? 'failed' : 'running'}
          percent={failed ? null : progress?.isRunning ? progress.percent : null}
          styleImageUrl={displayOutputImageUrl ?? displayStyleImageUrl}
          size={ringSize}
          showBackground={false}
        />
      ) : null}
    </div>
  )
}
