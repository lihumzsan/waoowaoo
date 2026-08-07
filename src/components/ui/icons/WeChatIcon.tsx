import type { SVGProps } from 'react'

export type WeChatIconProps = SVGProps<SVGSVGElement>

/** Two-bubble WeChat mark used to identify WeChat-owned actions. */
export function WeChatIcon(props: WeChatIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fill="currentColor"
        d="M9.3 3C4.72 3 1 6.08 1 9.88c0 2.16 1.2 4.08 3.08 5.34l-.7 2.43 2.85-1.42c.96.34 1.99.53 3.07.53.35 0 .69-.02 1.03-.06a6.07 6.07 0 0 1-.48-2.35c0-3.69 3.32-6.7 7.5-6.7h.16C16.37 4.95 13.16 3 9.3 3Zm-2.75 4.1a1.03 1.03 0 1 1 0 2.06 1.03 1.03 0 0 1 0-2.06Zm5.5 0a1.03 1.03 0 1 1 0 2.06 1.03 1.03 0 0 1 0-2.06Z"
      />
      <path
        fill="currentColor"
        d="M23 14.34c0-3.2-3.17-5.8-7.08-5.8-3.9 0-7.07 2.6-7.07 5.8s3.17 5.8 7.07 5.8c.91 0 1.78-.14 2.58-.39l2.43 1.25-.59-2.1c1.63-1.06 2.66-2.7 2.66-4.56Zm-9.43-1.57a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm4.7 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z"
      />
    </svg>
  )
}
