'use client'

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

/**
 * 进度条样式实验页 —— 仅用于设计评审，不接入业务逻辑。
 * 目标:统一画布中「视频生成」与「分镜图片生成」两套进度条,做到简约、符合系统玻璃风格。
 * 五种样式均为渲染中(进行时)状态展示。
 */

const ACCENT_FROM = 'var(--glass-accent-from)'
const ACCENT_TO = 'var(--glass-accent-to)'

function clamp(value: number) {
  return Math.max(0, Math.min(100, value))
}

/** 样式一:极简细线 —— 渐变填充 + 右侧数字,最克制 */
function VariantHairline({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[rgba(10,16,30,0.06)]">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${percent}%`,
            background: `linear-gradient(90deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
          }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-[13px] font-medium tabular-nums text-(--glass-text-secondary)">
        {Math.round(percent)}%
      </span>
    </div>
  )
}

/** 样式二:流光填充 —— 渐变条上有循环掠过的高光,强调「进行中」 */
function VariantShimmer({ percent }: { percent: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-(--glass-text-secondary)">生成中</span>
        <span className="text-[13px] font-semibold tabular-nums text-(--glass-text-primary)">
          {Math.round(percent)}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[rgba(10,16,30,0.06)]">
        <div
          className="relative h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${percent}%`,
            background: `linear-gradient(90deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
          }}
        >
          <div className="pbl-shimmer absolute inset-0" />
        </div>
      </div>
    </div>
  )
}

/** 样式三:柔光胶囊 —— 较高圆角轨道 + 内高光,温润有质感 */
function VariantGlow({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[rgba(10,16,30,0.05)] shadow-[inset_0_1px_2px_rgba(10,16,30,0.06)]">
        <div
          className="relative h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${percent}%`,
            background: `linear-gradient(90deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
            boxShadow: '0 0 12px rgba(47,123,255,0.35)',
          }}
        >
          <div className="absolute inset-x-0 top-0 h-1/2 rounded-full bg-white/30" />
        </div>
      </div>
      <span className="w-9 shrink-0 text-right text-[13px] font-semibold tabular-nums text-(--glass-text-primary)">
        {Math.round(percent)}%
      </span>
    </div>
  )
}

/** 样式四:环形 + 中心数字 —— 紧凑,适合卡片角标(替代截图里的 92% 圆环) */
function VariantRing({ percent }: { percent: number }) {
  const size = 56
  const progress = clamp(percent)

  return (
    <div className="flex items-center gap-3">
      <div
        className="relative grid shrink-0 place-items-center rounded-full transition-[background] duration-500 ease-out"
        style={{
          width: size,
          height: size,
          background: `conic-gradient(from -90deg, ${ACCENT_FROM} 0%, ${ACCENT_TO} ${progress}%, rgba(10,16,30,0.07) ${progress}%, rgba(10,16,30,0.07) 100%)`,
        }}
      >
        <div className="absolute inset-[5px] grid place-items-center rounded-full bg-white/80 shadow-[inset_0_1px_2px_rgba(10,16,30,0.06)]">
          <AppIcon
            name="loader"
            className="h-5 w-5 animate-spin text-[var(--glass-accent-from)]"
            aria-hidden="true"
          />
        </div>
        <span className="absolute inset-0 flex items-center justify-center pt-9 text-[11px] font-semibold tabular-nums text-(--glass-text-primary)">
          {Math.round(percent)}%
        </span>
      </div>
      <div className="space-y-0.5">
        <div className="text-[13px] font-medium text-(--glass-text-secondary)">最终视频</div>
        <div className="text-xs text-(--glass-text-tertiary)">渲染中…</div>
      </div>
    </div>
  )
}

/** 样式五:分段进度 —— 对应「镜头 1 / 2 / 3」,每段独立填充,适合连续片段 */
function VariantSegments({ percent }: { percent: number }) {
  const segments = 3
  const labels = ['镜头 1', '镜头 2', '镜头 3']
  const filledTotal = (clamp(percent) / 100) * segments

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {Array.from({ length: segments }).map((_, i) => {
          const fill = clamp((filledTotal - i) * 100)
          return (
            <div
              key={i}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(10,16,30,0.06)]"
            >
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${fill}%`,
                  background: `linear-gradient(90deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between">
        {labels.map((label) => (
          <span key={label} className="text-[11px] text-(--glass-text-tertiary)">
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

const VARIANTS = [
  { id: 'hairline', name: '极简细线', desc: '最克制,适合卡片内联展示', render: VariantHairline },
  { id: 'shimmer', name: '流光填充', desc: '高光循环掠过,强调进行中', render: VariantShimmer },
  { id: 'glow', name: '柔光胶囊', desc: '内高光 + 外发光,温润有质感', render: VariantGlow },
  { id: 'ring', name: '环形数字', desc: '紧凑角标,替代当前 92% 圆环', render: VariantRing },
  { id: 'segments', name: '分段镜头', desc: '对应连续片段,逐镜头填充', render: VariantSegments },
] as const

export default function ProgressBarLabClient() {
  const [percent, setPercent] = useState(64)
  const [auto, setAuto] = useState(true)

  useEffect(() => {
    if (!auto) return
    const timer = window.setInterval(() => {
      setPercent((prev) => (prev >= 100 ? 8 : prev + 2))
    }, 220)
    return () => window.clearInterval(timer)
  }, [auto])

  return (
    <div className="pbl-page min-h-screen w-full px-6 py-12 text-(--glass-text-primary)">
      <style>{`
        .pbl-page {
          background:
            radial-gradient(120% 80% at 0% 0%, rgba(47,123,255,0.16), transparent 55%),
            radial-gradient(120% 90% at 100% 10%, rgba(92,168,255,0.18), transparent 50%),
            radial-gradient(140% 120% at 50% 120%, rgba(140,110,255,0.14), transparent 55%),
            var(--glass-bg-canvas);
        }
        @keyframes pbl-shimmer {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(120%); }
        }
        .pbl-shimmer {
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255,255,255,0.55),
            transparent
          );
          animation: pbl-shimmer 1.6s ease-in-out infinite;
        }
        .pbl-card {
          background: rgba(255,255,255,0.55);
          backdrop-filter: blur(var(--glass-blur-lg)) saturate(1.4);
          -webkit-backdrop-filter: blur(var(--glass-blur-lg)) saturate(1.4);
          border: 1px solid rgba(255,255,255,0.6);
          box-shadow: var(--glass-shadow-md);
        }
      `}</style>

      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">进度条样式实验</h1>
          <p className="mt-1.5 text-sm text-(--glass-text-tertiary)">
            统一「视频生成 / 分镜图片生成」进度条 · 五种简约方案 · 渲染中状态
          </p>
        </header>

        {/* 控制条 */}
        <div className="pbl-card mb-8 flex items-center gap-4 rounded-[var(--glass-radius-md)] px-5 py-4">
          <span className="shrink-0 text-[13px] font-medium text-(--glass-text-secondary)">
            进度 {Math.round(percent)}%
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => {
              setAuto(false)
              setPercent(Number(e.target.value))
            }}
            className="h-1.5 flex-1 cursor-pointer accent-[var(--glass-accent-from)]"
          />
          <button
            type="button"
            onClick={() => setAuto((a) => !a)}
            className="shrink-0 rounded-full border border-[rgba(10,16,30,0.12)] px-3.5 py-1.5 text-[13px] font-medium text-(--glass-text-secondary) transition-colors hover:bg-[rgba(10,16,30,0.04)]"
          >
            {auto ? '暂停自动' : '自动播放'}
          </button>
        </div>

        {/* 五种样式 */}
        <div className="space-y-4">
          {VARIANTS.map((variant, index) => {
            const Render = variant.render
            return (
              <div
                key={variant.id}
                className="pbl-card rounded-[var(--glass-radius-lg)] px-6 py-5"
              >
                <div className="mb-4 flex items-baseline justify-between">
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-[13px] font-semibold tabular-nums text-(--glass-text-tertiary)">
                      0{index + 1}
                    </span>
                    <span className="text-[15px] font-semibold text-(--glass-text-primary)">
                      {variant.name}
                    </span>
                  </div>
                  <span className="text-xs text-(--glass-text-tertiary)">{variant.desc}</span>
                </div>
                <Render percent={percent} />
              </div>
            )
          })}
        </div>

        <footer className="mt-10 text-center text-xs text-(--glass-text-tertiary)">
          仅用于设计评审 · 选定方案后再统一接入业务进度状态
        </footer>
      </div>
    </div>
  )
}
