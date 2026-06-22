#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const REQUIRED_KEYS = [
  'DEPLOYMENT_EDITION',
  'PROVIDER_CREDENTIAL_MODE',
  'BILLING_MODE',
  'NEXTAUTH_URL',
  'INTERNAL_APP_URL',
  'OFFICIAL_CONTENT_DIR',
  'PAYMENT_MIN_CREDITS',
  'PAYMENT_MAX_CREDITS',
  'PAYMENT_CNY_TO_HKD_RATE',
  'PAYMENT_PUBLIC_BASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
]

const DEFAULT_MODEL_KEYS = [
  'PLATFORM_DEFAULT_ANALYSIS_MODEL',
  'PLATFORM_DEFAULT_CHARACTER_MODEL',
  'PLATFORM_DEFAULT_LOCATION_MODEL',
  'PLATFORM_DEFAULT_STORYBOARD_MODEL',
  'PLATFORM_DEFAULT_EDIT_MODEL',
  'PLATFORM_DEFAULT_VIDEO_MODEL',
  'PLATFORM_DEFAULT_MUSIC_MODEL',
]

const PLATFORM_KEY_BY_PROVIDER = {
  google: 'PLATFORM_GOOGLE_API_KEY',
  fal: 'PLATFORM_FAL_API_KEY',
  ark: 'PLATFORM_ARK_API_KEY',
  openrouter: 'PLATFORM_OPENROUTER_API_KEY',
}

function parseEnvLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const equalsIndex = trimmed.indexOf('=')
  if (equalsIndex <= 0) return null
  const key = trimmed.slice(0, equalsIndex).trim()
  let value = trimmed.slice(equalsIndex + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  return { key, value }
}

function readEnvFile(filePath) {
  const raw = readFileSync(filePath, 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line)
    if (parsed) env[parsed.key] = parsed.value
  }
  return env
}

function isMissing(value) {
  return typeof value !== 'string' || value.trim() === ''
}

function readModelProvider(modelKey) {
  if (isMissing(modelKey)) return null
  const separatorIndex = modelKey.indexOf('::')
  if (separatorIndex <= 0) return null
  return modelKey.slice(0, separatorIndex)
}

const envFile = process.argv[2] || '.env.cloud.local'
if (!existsSync(envFile)) {
  console.error(`CLOUD_ENV_FILE_MISSING:${envFile}`)
  console.error('Copy .env.cloud.example to .env.cloud.local and fill the private values.')
  process.exit(1)
}

const env = readEnvFile(envFile)
const missing = REQUIRED_KEYS.filter((key) => isMissing(env[key]))

if (env.DEPLOYMENT_EDITION !== 'cloud') {
  missing.push('DEPLOYMENT_EDITION=cloud')
}
if (env.PROVIDER_CREDENTIAL_MODE !== 'platform-key') {
  missing.push('PROVIDER_CREDENTIAL_MODE=platform-key')
}
if (env.BILLING_MODE !== 'ENFORCE') {
  missing.push('BILLING_MODE=ENFORCE')
}

const requiredPlatformKeys = new Set()
for (const modelEnvKey of DEFAULT_MODEL_KEYS) {
  const provider = readModelProvider(env[modelEnvKey])
  if (!provider) {
    missing.push(`${modelEnvKey}=provider::model`)
    continue
  }
  const platformKey = PLATFORM_KEY_BY_PROVIDER[provider]
  if (!platformKey) {
    missing.push(`PLATFORM_PROVIDER_SUPPORTED:${provider}`)
    continue
  }
  requiredPlatformKeys.add(platformKey)
}

for (const key of requiredPlatformKeys) {
  if (isMissing(env[key])) {
    missing.push(key)
  }
}

if (!isMissing(env.OFFICIAL_CONTENT_DIR)) {
  const contentDir = path.isAbsolute(env.OFFICIAL_CONTENT_DIR)
    ? env.OFFICIAL_CONTENT_DIR
    : path.resolve(process.cwd(), env.OFFICIAL_CONTENT_DIR)
  if (!existsSync(contentDir)) {
    missing.push(`OFFICIAL_CONTENT_DIR_EXISTS:${contentDir}`)
  }
}

if (missing.length > 0) {
  console.error('CLOUD_ENV_INVALID')
  for (const key of missing) {
    console.error(`- ${key}`)
  }
  process.exit(1)
}

console.log(`CLOUD_ENV_OK:${envFile}`)
