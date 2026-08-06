import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path'
import { realpathSync } from 'node:fs'

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

const configuredDistDir = process.env.NEXT_DIST_DIR?.trim() || ''
if (configuredDistDir && (configuredDistDir.startsWith('/') || configuredDistDir.includes('..'))) {
  throw new Error('NEXT_DIST_DIR must be a relative project-local directory')
}

const nextDistDir = configuredDistDir || '.next'
const configuredTypeScriptConfig = process.env.NEXT_TSCONFIG_PATH?.trim() || ''
if (configuredTypeScriptConfig && (
  configuredTypeScriptConfig.startsWith('/')
  || configuredTypeScriptConfig.includes('..')
  || !configuredTypeScriptConfig.endsWith('.json')
)) {
  throw new Error('NEXT_TSCONFIG_PATH must be a relative project-local JSON file')
}

function sharedDependencyTurbopackRoot(): string | null {
  const projectRoot = process.cwd()
  const dependencyRoot = realpathSync(path.join(projectRoot, 'node_modules'))
  if (dependencyRoot === projectRoot || dependencyRoot.startsWith(`${projectRoot}${path.sep}`)) return null
  const projectParts = projectRoot.split(path.sep)
  const dependencyParts = dependencyRoot.split(path.sep)
  let sharedLength = 0
  while (
    sharedLength < projectParts.length
    && sharedLength < dependencyParts.length
    && projectParts[sharedLength] === dependencyParts[sharedLength]
  ) sharedLength += 1
  return projectParts.slice(0, sharedLength).join(path.sep) || path.parse(projectRoot).root
}

const turbopackRoot = sharedDependencyTurbopackRoot()

const allowedDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "form-action 'self'",
      // Stripe.js has to be loaded from Stripe's own origin — they do not
      // support self-hosting it, because the script is how card data and
      // payment authentication stay outside our page. Without this the WeChat
      // QR flow fails with nothing but a generic error.
      `script-src 'self' 'unsafe-inline' https://js.stripe.com${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      // Stripe.js mounts hidden iframes for payment authentication.
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "worker-src 'self' blob:",
    ].join('; '),
  },
]

const globalFunctionTraceExcludes = [
  './.git/**/*',
  `./${nextDistDir}/cache/**/*`,
  './docker-logs/**/*',
  './logs/**/*',
  './*.log',
]

const nextConfig: NextConfig = {
  ...(configuredDistDir ? { distDir: configuredDistDir } : {}),
  ...(configuredTypeScriptConfig ? { typescript: { tsconfigPath: configuredTypeScriptConfig } } : {}),
  ...(turbopackRoot ? { turbopack: { root: turbopackRoot } } : {}),
  // 已删除 ignoreBuildErrors / ignoreDuringBuilds，构建保持严格门禁
  // Next 15 的 allowedDevOrigins 是顶层配置，不属于 experimental
  logging: false,
  devIndicators: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.googleusercontent.com' },
      { protocol: 'https', hostname: '**.ggpht.com' },
    ],
  },
  outputFileTracingExcludes: {
    '/*': globalFunctionTraceExcludes,
    '/api/*': globalFunctionTraceExcludes,
    '/api/**/*': globalFunctionTraceExcludes,
  },
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  async rewrites() {
    return [{ source: '/favicon.ico', destination: '/logo.ico' }]
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
};

export default withNextIntl(nextConfig);
