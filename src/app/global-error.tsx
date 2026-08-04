'use client'

import { useEffect } from 'react'
import { reportClientError } from '@/lib/errors/client-reporter'

interface GlobalErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * 根级兜底 error boundary。
 *
 * Next.js 要求 global-error 自带 <html>/<body>，且它渲染在
 * NextIntlClientProvider 与 [locale] 段之外，locale 在此层不可得。
 * 这是框架限制导致的 i18n 例外：此文件允许使用最小中英双语静态文案，
 * 全仓其余用户可见文案仍必须走 i18n。
 */
export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  useEffect(() => {
    reportClientError({
      kind: 'react-render',
      message: error.message || error.name || 'Root render error',
      stack: error.stack,
    })
  }, [error])

  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            padding: '24px',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1 style={{ fontSize: '20px', fontWeight: 600 }}>
            出错了 / Something went wrong
          </h1>
          <p style={{ fontSize: '14px', opacity: 0.7, maxWidth: '28rem' }}>
            发生了意外错误，请重试。 / An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <code style={{ fontSize: '12px', opacity: 0.7 }}>
              错误编号 / Error ID: {error.digest}
            </code>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '8px',
              padding: '8px 24px',
              fontSize: '14px',
              borderRadius: '9999px',
              border: '1px solid currentColor',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            重试 / Retry
          </button>
        </main>
      </body>
    </html>
  )
}
