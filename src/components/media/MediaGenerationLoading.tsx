'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { BrandLoading } from '@/components/ui/BrandLoading'
import { AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import {
  useEstimatedTaskProgress,
  type EstimatedTaskProgressSource,
} from '@/lib/query/hooks/useEstimatedTaskProgress'

/**
 * 媒体生成「加载中 / 失败」统一展示组件 —— 全站唯一入口。
 *
 * 设计:模糊的视觉风格图(或退回模糊磨砂底)做背景 + 系统品牌动效(BrandLoading)
 *   + 环绕进度环 + 数字。进度来自系统唯一来源 useEstimatedTaskProgress。
 *
 * 画布(分镜 / 图片 / 视频)与资产图片三处统一调用本组件,不再各写各的加载层。
 * 完成 / 非进行中时返回 null。
 */

type Tone = 'on-dark' | 'on-light'

interface MediaGenerationLoadingProps {
  /** 进度来源(系统统一的运行时状态);为空则不渲染 */
  readonly taskState: EstimatedTaskProgressSource | null | undefined
  /** 用户选中的视觉风格图(storage key 或 URL);无则退回模糊磨砂底 */
  readonly styleImageUrl: string | null
  /** 环直径(px),按容器大小传入 */
  readonly size?: number
  readonly className?: string
  readonly showBackground?: boolean
}

interface MediaGenerationLoadingViewProps {
  readonly mode: 'running' | 'failed'
  /** 0–100;null 表示拿不到进度(只转动效、不显示数字) */
  readonly percent: number | null
  readonly styleImageUrl: string | null
  readonly size: number
  readonly className?: string
  readonly showBackground?: boolean
  readonly showPercentLabel?: boolean
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/** 纯展示层:背景 + 品牌动效 + 环绕进度环 + 数字 / 失败态 */
export function MediaGenerationLoadingView({
  mode,
  percent,
  styleImageUrl,
  size,
  className,
  showBackground = true,
  showPercentLabel = true,
}: MediaGenerationLoadingViewProps) {
  const t = useTranslations('common')
  const displayStyleUrl = toDisplayImageUrl(styleImageUrl)
  const tone: Tone = displayStyleUrl ? 'on-dark' : 'on-light'

  const stroke = Math.max(3, Math.round(size * 0.05))
  const progressDegrees = percent === null ? 0 : (clampPercent(percent) / 100) * 360
  const trackColor = tone === 'on-dark' ? 'rgba(255,255,255,0.4)' : 'rgba(10,16,30,0.1)'
  const numberSize = Math.max(11, Math.round(size * 0.16))

  return (
    <div
      className={[
        'pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 overflow-hidden',
        className || '',
      ].join(' ').trim()}
    >
      {/* 背景:模糊风格图 + 暗化压底,或退回模糊磨砂底 */}
      {showBackground ? (
        displayStyleUrl ? (
          <>
            <div
              className="absolute inset-0 scale-110"
              style={{
                backgroundImage: `url("${displayStyleUrl}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(14px)',
              }}
            />
            <div className="absolute inset-0 bg-[rgba(10,16,30,0.32)]" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[var(--glass-bg-muted)]" />
        )
      ) : null}

      {mode === 'failed' ? (
        <div className="relative z-[1] flex flex-col items-center gap-2 px-4 text-center">
          <AppIcon
            name="alertSolid"
            className={
              tone === 'on-dark'
                ? 'h-7 w-7 text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)]'
                : 'h-7 w-7 text-[var(--glass-tone-danger-fg)]'
            }
          />
          <span
            className={
              tone === 'on-dark'
                ? 'text-xs font-semibold text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)]'
                : 'text-xs font-semibold text-[var(--glass-tone-danger-fg)]'
            }
          >
            {t('taskStatus.failed.generic')}
          </span>
        </div>
      ) : (
        <>
          <div
            className="relative z-[1] grid place-items-center"
            style={{ width: size, height: size }}
            role="progressbar"
            aria-label={t('taskStatus.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent === null ? undefined : Math.round(percent)}
          >
            <div
              className="absolute inset-0 -rotate-90 rounded-full transition-[background] duration-500 ease-out"
              style={{
                background:
                  percent === null
                    ? trackColor
                    : `conic-gradient(var(--glass-accent-from) 0deg, var(--glass-accent-to) ${progressDegrees}deg, ${trackColor} ${progressDegrees}deg 360deg)`,
                WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`,
                mask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`,
              }}
            />
            <BrandLoading imageSize={Math.round(size * 0.5)} />
          </div>
          {percent !== null && showPercentLabel ? (
            <span
              className={
                tone === 'on-dark'
                  ? 'relative z-[1] font-semibold tabular-nums text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)]'
                  : 'relative z-[1] font-semibold tabular-nums text-[var(--glass-text-primary)]'
              }
              style={{ fontSize: numberSize }}
            >
              {Math.floor(clampPercent(percent))}%
            </span>
          ) : null}
        </>
      )}
    </div>
  )
}

/** 统一入口:接系统运行时状态,内部走 useEstimatedTaskProgress,自动处理运行 / 失败 / 隐藏。 */
export default function MediaGenerationLoading({
  taskState,
  styleImageUrl,
  size = 72,
  className,
  showBackground = true,
}: MediaGenerationLoadingProps) {
  const progress = useEstimatedTaskProgress(taskState)
  if (!progress) return null
  if (progress.isCompleted || (!progress.isRunning && !progress.isFailed)) return null

  return (
    <MediaGenerationLoadingView
      mode={progress.isFailed ? 'failed' : 'running'}
      percent={progress.isFailed ? null : progress.percent}
      styleImageUrl={styleImageUrl}
      size={size}
      className={className}
      showBackground={showBackground}
    />
  )
}
