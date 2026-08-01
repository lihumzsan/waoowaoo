import Link from 'next/link'

/**
 * Root fallback is outside the locale provider, matching global-error.tsx.
 * Locale-routed pages use [locale]/not-found.tsx and fully translated copy.
 */
export default function RootNotFoundPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
      <p style={{ opacity: 0.65 }}>404</p>
      <h1>页面不存在 / Page not found</h1>
      <p>链接可能已失效。 / The link may no longer be valid.</p>
      <Link href="/" style={{ textDecoration: 'underline' }}>返回首页 / Back home</Link>
    </main>
  )
}
