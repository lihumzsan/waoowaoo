'use client'

import Image from 'next/image'

type BrandLogoMarkMotion = 'static' | 'loading'

interface BrandLogoMarkProps {
  className?: string
  height?: number
  motion?: BrandLogoMarkMotion
  title: string
  width?: number
}

const BRAND_LOGO_STYLE = `
.brand-logo-mark__reveal {
  transform-origin: 50% 50%;
  animation: brand-logo-mark-reveal 3.2s ease-in-out infinite;
}

.brand-logo-mark__sweep {
  animation: brand-logo-mark-sweep 3.2s ease-in-out infinite;
}

@keyframes brand-logo-mark-reveal {
  0% { opacity: 0.26; transform: scale(0.96); }
  56% { opacity: 1; transform: scale(1); }
  82% { opacity: 1; transform: scale(1); }
  100% { opacity: 0.26; transform: scale(0.96); }
}

@keyframes brand-logo-mark-sweep {
  0% { opacity: 0; transform: translateX(-140%); }
  14% { opacity: 0.7; }
  58% { opacity: 0.8; transform: translateX(340%); }
  82% { opacity: 0; transform: translateX(340%); }
  100% { opacity: 0; transform: translateX(-140%); }
}

@media (prefers-reduced-motion: reduce) {
  .brand-logo-mark__reveal,
  .brand-logo-mark__sweep {
    animation: none;
  }

  .brand-logo-mark__reveal {
    opacity: 1;
    transform: scale(1);
  }

  .brand-logo-mark__sweep {
    opacity: 0;
  }
}
`

function joinClassNames(classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function BrandLogoMark({
  className,
  height = 1080,
  motion = 'static',
  title,
  width = 1080,
}: BrandLogoMarkProps) {
  const isLoading = motion === 'loading'

  return (
    <span
      aria-label={title}
      className={joinClassNames([
        'brand-logo-mark relative inline-grid shrink-0 place-items-center overflow-hidden',
        className,
      ])}
      data-brand-logo-motion={motion}
      role="img"
      style={{ width, height }}
    >
      {isLoading ? <style>{BRAND_LOGO_STYLE}</style> : null}
      <Image
        src="/logo-small.png"
        alt=""
        width={width}
        height={height}
        aria-hidden="true"
        className={joinClassNames([
          'h-full w-full object-contain',
          isLoading ? 'opacity-30' : undefined,
        ])}
        {...(isLoading ? { priority: true } : {})}
      />
      {isLoading ? (
        <>
          <Image
            src="/logo-small.png"
            alt=""
            width={width}
            height={height}
            aria-hidden="true"
            className="brand-logo-mark__reveal absolute inset-0 h-full w-full object-contain"
            priority
          />
          <span
            aria-hidden="true"
            className="brand-logo-mark__sweep pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.62),rgba(125,211,252,0.82),rgba(255,255,255,0))]"
          />
        </>
      ) : null}
    </span>
  )
}
