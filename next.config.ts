import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

const configuredDistDir = process.env.NEXT_DIST_DIR?.trim() || ''
if (configuredDistDir && (configuredDistDir.startsWith('/') || configuredDistDir.includes('..'))) {
  throw new Error('NEXT_DIST_DIR must be a relative project-local directory')
}

const nextDistDir = configuredDistDir || '.next'

const globalFunctionTraceExcludes = [
  './.git/**/*',
  `./${nextDistDir}/cache/**/*`,
  './docker-logs/**/*',
  './logs/**/*',
  './*.log',
]

const nextConfig: NextConfig = {
  ...(configuredDistDir ? { distDir: configuredDistDir } : {}),
  // 已删除 ignoreBuildErrors / ignoreDuringBuilds，构建保持严格门禁
  // Next 15 的 allowedDevOrigins 是顶层配置，不属于 experimental
  logging: false,
  devIndicators: false,
  outputFileTracingExcludes: {
    '/*': globalFunctionTraceExcludes,
    '/api/*': globalFunctionTraceExcludes,
    '/api/**/*': globalFunctionTraceExcludes,
  },
  allowedDevOrigins: [
    'http://192.168.31.218:3000',
    'http://192.168.31.*:3000',
  ],
};

export default withNextIntl(nextConfig);
