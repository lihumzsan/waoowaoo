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

const globalFunctionTraceExcludes = [
  './.git/**/*',
  `./${nextDistDir}/cache/**/*`,
  './docker-logs/**/*',
  './logs/**/*',
  './*.log',
]

const nextConfig: NextConfig = {
  ...(configuredDistDir ? { distDir: configuredDistDir } : {}),
  ...(turbopackRoot ? { turbopack: { root: turbopackRoot } } : {}),
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
