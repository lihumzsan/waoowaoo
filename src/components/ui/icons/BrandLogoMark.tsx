'use client'

import { useId } from 'react'

type BrandLogoMarkMotion = 'static' | 'loading'

interface BrandLogoMarkProps {
  className?: string
  height?: number
  motion?: BrandLogoMarkMotion
  title: string
  width?: number
}

const BRAND_LOGO_BODY_PATH = [
  'M88 437',
  'C88 366 126 323 183 322',
  'C247 321 268 370 284 438',
  'C302 516 350 567 413 561',
  'C478 555 500 473 553 444',
  'C603 417 665 429 707 471',
  'C748 512 772 550 819 534',
  'C858 521 870 460 906 442',
  'C944 423 988 449 1009 501',
  'C1044 589 1006 713 925 784',
  'C850 850 755 857 681 815',
  'C624 783 602 720 561 734',
  'C533 744 518 785 477 812',
  'C384 874 250 856 168 764',
  'C99 687 75 548 88 437',
  'Z',
].join(' ')

const BRAND_LOGO_GLOSS_PATH = [
  'M456 516',
  'C509 530 514 668 569 731',
  'C611 779 673 833 755 838',
  'C655 862 579 812 536 738',
  'C500 676 494 567 456 516',
  'Z',
].join(' ')

const BRAND_LOGO_STYLE = `
.brand-logo-mark__reveal {
  transform-box: fill-box;
  transform-origin: 0 50%;
  animation: brand-logo-mark-reveal 3.2s ease-in-out infinite;
}

.brand-logo-mark__sweep {
  transform-box: fill-box;
  animation: brand-logo-mark-sweep 3.2s ease-in-out infinite;
}

@keyframes brand-logo-mark-reveal {
  0% { transform: scaleX(0.08); }
  56% { transform: scaleX(1); }
  82% { transform: scaleX(1); }
  100% { transform: scaleX(0.08); }
}

@keyframes brand-logo-mark-sweep {
  0% { opacity: 0; transform: translateX(-480px); }
  14% { opacity: 0.7; }
  58% { opacity: 0.8; transform: translateX(1180px); }
  82% { opacity: 0; transform: translateX(1180px); }
  100% { opacity: 0; transform: translateX(-480px); }
}

@media (prefers-reduced-motion: reduce) {
  .brand-logo-mark__reveal,
  .brand-logo-mark__sweep {
    animation: none;
  }

  .brand-logo-mark__reveal {
    transform: scaleX(1);
  }

  .brand-logo-mark__sweep {
    opacity: 0;
  }
}
`

function joinClassNames(classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

function buildSvgId(seed: string, suffix: string): string {
  return `brand-logo-${seed.replace(/[^a-zA-Z0-9_-]/g, '')}-${suffix}`
}

export function BrandLogoMark({
  className,
  height = 1080,
  motion = 'static',
  title,
  width = 1080,
}: BrandLogoMarkProps) {
  const idSeed = useId()
  const shapeId = buildSvgId(idSeed, 'shape')
  const revealId = buildSvgId(idSeed, 'reveal')
  const sweepGradientId = buildSvgId(idSeed, 'sweep')
  const titleId = buildSvgId(idSeed, 'title')
  const isLoading = motion === 'loading'

  return (
    <svg
      aria-labelledby={titleId}
      className={joinClassNames(['brand-logo-mark', className])}
      data-brand-logo-motion={motion}
      height={height}
      role="img"
      viewBox="0 0 1080 1080"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id={titleId}>{title}</title>
      <defs>
        <clipPath id={shapeId} clipPathUnits="userSpaceOnUse">
          <path d={BRAND_LOGO_BODY_PATH} />
          <circle cx="888" cy="270" r="101" />
        </clipPath>
        {isLoading ? (
          <clipPath id={revealId} clipPathUnits="userSpaceOnUse">
            <rect className="brand-logo-mark__reveal" height="1080" width="1080" x="0" y="0" />
          </clipPath>
        ) : null}
        <linearGradient id={sweepGradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="42%" stopColor="#ffffff" stopOpacity="0.62" />
          <stop offset="58%" stopColor="#7dd3fc" stopOpacity="0.82" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {isLoading ? <style>{BRAND_LOGO_STYLE}</style> : null}
      <g clipPath={`url(#${shapeId})`}>
        {isLoading ? (
          <>
            <image
              height="1080"
              href="/logo-small.png"
              opacity="0.26"
              preserveAspectRatio="xMidYMid meet"
              width="1080"
              x="0"
              y="0"
            />
            <g clipPath={`url(#${revealId})`}>
              <image
                height="1080"
                href="/logo-small.png"
                preserveAspectRatio="xMidYMid meet"
                width="1080"
                x="0"
                y="0"
              />
            </g>
            <rect
              className="brand-logo-mark__sweep"
              fill={`url(#${sweepGradientId})`}
              height="1080"
              opacity="0"
              width="360"
              x="-360"
              y="0"
            />
          </>
        ) : (
          <image
            height="1080"
            href="/logo-small.png"
            preserveAspectRatio="xMidYMid meet"
            width="1080"
            x="0"
            y="0"
          />
        )}
        <path d={BRAND_LOGO_GLOSS_PATH} fill="#ffffff" opacity="0.08" />
      </g>
    </svg>
  )
}
