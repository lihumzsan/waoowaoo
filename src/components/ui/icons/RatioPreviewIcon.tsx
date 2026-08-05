import type { CSSProperties } from 'react'

type RatioPreviewVariant = 'surface' | 'surfaceStrong' | 'muted'
type RatioPreviewFit = 'box' | 'height'

export interface RatioPreviewIconProps {
  ratio: string
  size?: number
  selected?: boolean
  variant?: RatioPreviewVariant
  fit?: RatioPreviewFit
  radiusClassName?: string
}

function resolveUnselectedClass(variant: RatioPreviewVariant): string {
  if (variant === 'surface') {
    return 'bg-[var(--glass-bg-surface)] shadow-[0_0_0_1px_rgba(163,181,214,0.25)]'
  }
  if (variant === 'muted') {
    return 'bg-[rgba(88,92,128,0.14)] shadow-[0_0_0_1px_rgba(88,92,128,0.26)]'
  }
  return 'bg-[var(--glass-bg-surface-strong)] shadow-[0_0_0_1px_rgba(163,181,214,0.24)]'
}

export function RatioPreviewIcon({
  ratio,
  size = 24,
  selected = false,
  variant = 'surfaceStrong',
  fit = 'box',
  radiusClassName = 'rounded-[6px]',
}: RatioPreviewIconProps) {
  const [widthRatio, heightRatio] = ratio.split(':').map(Number)
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    throw new Error(`Invalid ratio for RatioPreviewIcon: ${ratio}`)
  }

  let width = size
  let height = size

  if (fit === 'height') {
    width = Math.round((size * widthRatio) / heightRatio)
  } else if (widthRatio >= heightRatio) {
    height = Math.round((size * heightRatio) / widthRatio)
  } else {
    width = Math.round((size * widthRatio) / heightRatio)
  }

  const style: CSSProperties = {
    width,
    height,
    minWidth: width,
    minHeight: height,
  }

  const toneClass = selected
    ? 'bg-[var(--glass-tone-soft)] shadow-[0_0_0_1px_var(--glass-stroke-strong)]'
    : resolveUnselectedClass(variant)

  return <span aria-hidden="true" className={`${radiusClassName} block transition-all ${toneClass}`} style={style} />
}
