import { readFileSync } from 'node:fs'
import path from 'node:path'

const configuredDistDir = process.env.NEXT_DIST_DIR?.trim() || '.next'
const manifestPath = path.join(configuredDistDir, 'server', 'middleware-manifest.json')

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  const detail = error instanceof Error ? error.message : 'unknown error'
  throw new Error(`NEXT_BUILD_MIDDLEWARE_MANIFEST_INVALID:${detail}`)
}

const middleware = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
  ? manifest.middleware
  : null
const rootMiddleware = middleware && typeof middleware === 'object' && !Array.isArray(middleware)
  ? middleware['/']
  : null
const files = rootMiddleware && typeof rootMiddleware === 'object' && !Array.isArray(rootMiddleware)
  ? rootMiddleware.files
  : null

if (!Array.isArray(files) || files.length === 0 || files.some((file) => typeof file !== 'string')) {
  throw new Error('NEXT_BUILD_LOCALE_MIDDLEWARE_MISSING')
}

process.stdout.write(`NEXT_BUILD_ARTIFACTS_OK:${configuredDistDir}\n`)
