import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ACTIVE_ACCEPTANCE_SURFACES = [
  '.env.example',
  '.github/workflows/verify.yml',
  'tests/setup/env.ts',
  'tests/browser-security/runtime/start-environment.ts',
  'README.md',
  'README_en.md',
  'package.json',
]

const FORBIDDEN_PATTERNS = [
  {
    label: 'external provider model',
    pattern: /\b(?!(?:codex|comfyui)::)[a-z][a-z0-9_-]*::[^\s'"`]+/iu,
  },
  {
    label: 'external provider credential',
    pattern: /\b(?:PLATFORM_[A-Z0-9_]+_(?:API_KEY|BASE_URL)|[A-Z0-9_]+_QUEUE_BASE_URL)\b/u,
  },
  {
    label: 'external OpenAI API',
    pattern: /\b(?:OPENAI_API_KEY|OPENAI_WEB_SEARCH_MODEL)\b/u,
  },
  {
    label: 'routed text model',
    pattern: /\bPLATFORM_DEFAULT_(?:ASSISTANT|ANALYSIS|UTILITY)_MODEL\b/u,
  },
  {
    label: 'cloud deployment',
    pattern: /\bDEPLOYMENT_EDITION\s*[:=]\s*['"]?cloud\b/iu,
  },
  {
    label: 'cloud development entry',
    pattern: /(?:npm\s+run\s+dev:cloud|\.env\.cloud\.(?:example|local))/iu,
  },
]

function checkLocalProviderBoundary({ rootDir }) {
  const violations = []

  if (existsSync(path.join(rootDir, '.env.cloud.example'))) {
    violations.push('obsolete cloud example: .env.cloud.example')
  }

  for (const relativePath of ACTIVE_ACCEPTANCE_SURFACES) {
    const absolutePath = path.join(rootDir, relativePath)
    if (!existsSync(absolutePath)) continue
    const content = readFileSync(absolutePath, 'utf8')
    for (const forbidden of FORBIDDEN_PATTERNS) {
      if (forbidden.pattern.test(content)) {
        violations.push(`${forbidden.label}: ${relativePath}`)
      }
    }
  }

  return { violations: [...new Set(violations)].sort() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = checkLocalProviderBoundary({ rootDir: process.cwd() })
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      process.stderr.write(`[check-local-provider-boundary] ${violation}\n`)
    }
    process.exitCode = 1
  } else {
    process.stdout.write('[check-local-provider-boundary] OK\n')
  }
}

export { checkLocalProviderBoundary }
