import type { SVGProps } from 'react'

export type AlipayIconProps = SVGProps<SVGSVGElement>

/** Compact Alipay identifier for payment-method selectors. */
export function AlipayIcon(props: AlipayIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fill="currentColor"
        d="M5.1 4.2h13.8c1.05 0 1.9.85 1.9 1.9v11.8c0 1.05-.85 1.9-1.9 1.9H5.1a1.9 1.9 0 0 1-1.9-1.9V6.1c0-1.05.85-1.9 1.9-1.9Z"
      />
      <path
        fill="#1677FF"
        d="M7.15 10.05h3.55V8.92H6.42V7.78h4.28V6.54h1.42v1.24h4.35v1.14h-4.35v1.13h3.62c-.34 1.82-1.08 3.31-2.18 4.47 1.21.53 2.6.96 4.18 1.29l-.5 1.3a20.9 20.9 0 0 1-4.82-1.63c-1.55 1.04-3.48 1.72-5.78 2.04l-.39-1.28c1.87-.26 3.47-.75 4.78-1.48a12.27 12.27 0 0 1-2.57-2.35l1.18-.7a10.4 10.4 0 0 0 2.54 2.26c.82-.77 1.43-1.7 1.83-2.8H7.15v-1.12Z"
      />
    </svg>
  )
}
