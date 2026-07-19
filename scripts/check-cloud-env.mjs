#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const COMMON_REQUIRED_KEYS = [
  'DEPLOYMENT_EDITION',
  'PROVIDER_CREDENTIAL_MODE',
  'BILLING_MODE',
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',
  'CRON_SECRET',
  'API_ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'INTERNAL_APP_URL',
  'OFFICIAL_CONTENT_DIR',
  'PAYMENT_MIN_CREDITS',
  'PAYMENT_MAX_CREDITS',
  'PAYMENT_PUBLIC_BASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
]

const PRODUCTION_REQUIRED_KEYS = [
  'ADMIN_USER_IDS',
  'ADMIN_CREDIT_TOKEN',
  'BULL_BOARD_USER',
  'BULL_BOARD_PASSWORD',
  'TRUSTED_PROXY_HOPS',
]

const VALIDATION_MODES = new Set(['development', 'production'])

const DEFAULT_MODEL_KEYS = [
  'PLATFORM_DEFAULT_ASSISTANT_MODEL',
  'PLATFORM_DEFAULT_ANALYSIS_MODEL',
  'PLATFORM_DEFAULT_CHARACTER_MODEL',
  'PLATFORM_DEFAULT_LOCATION_MODEL',
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

const PLATFORM_BASE_URL_BY_PROVIDER = {
  openrouter: 'PLATFORM_OPENROUTER_BASE_URL',
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

function isWeakSecret(value) {
  if (isMissing(value)) return true
  const normalized = value.trim().toLowerCase()
  return value.trim().length < 24
    || normalized.includes('please-change')
    || normalized.includes('changeme')
    || normalized.includes('default-secret')
    || normalized.includes('example')
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isLoopbackHost(value) {
  const normalized = value.trim().toLowerCase()
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]'
}

function isDevelopmentUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && isLoopbackHost(url.hostname))
  } catch {
    return false
  }
}

function readModelProvider(modelKey) {
  if (isMissing(modelKey)) return null
  const separatorIndex = modelKey.indexOf('::')
  if (separatorIndex <= 0) return null
  return modelKey.slice(0, separatorIndex)
}

const envFile = process.argv[2] || '.env.cloud.local'
const modeArgument = process.argv[3] || '--mode=production'
const validationMode = modeArgument.startsWith('--mode=')
  ? modeArgument.slice('--mode='.length)
  : ''
if (!VALIDATION_MODES.has(validationMode)) {
  console.error(`CLOUD_ENV_MODE_INVALID:${modeArgument}`)
  console.error('Use --mode=development or --mode=production.')
  process.exit(1)
}

if (!existsSync(envFile)) {
  console.error(`CLOUD_ENV_FILE_MISSING:${envFile}`)
  console.error('Copy .env.cloud.example to .env.cloud.local and fill the private values.')
  process.exit(1)
}

const env = readEnvFile(envFile)
const requiredKeys = validationMode === 'production'
  ? [...COMMON_REQUIRED_KEYS, ...PRODUCTION_REQUIRED_KEYS]
  : COMMON_REQUIRED_KEYS
const missing = requiredKeys.filter((key) => isMissing(env[key]))

if (env.DEPLOYMENT_EDITION !== 'cloud') {
  missing.push('DEPLOYMENT_EDITION=cloud')
}
if (env.PROVIDER_CREDENTIAL_MODE !== 'platform-key') {
  missing.push('PROVIDER_CREDENTIAL_MODE=platform-key')
}
if (env.BILLING_MODE !== 'ENFORCE') {
  missing.push('BILLING_MODE=ENFORCE')
}

for (const key of ['NEXTAUTH_SECRET', 'CRON_SECRET', 'API_ENCRYPTION_KEY']) {
  if (!isMissing(env[key]) && isWeakSecret(env[key])) missing.push(`${key}=strong-secret-at-least-24-characters`)
}
if (!isMissing(env.ADMIN_CREDIT_TOKEN) && isWeakSecret(env.ADMIN_CREDIT_TOKEN)) {
  missing.push('ADMIN_CREDIT_TOKEN=strong-secret-at-least-24-characters')
}

const isAllowedUrl = validationMode === 'production' ? isHttpsUrl : isDevelopmentUrl
const requiredUrlDescription = validationMode === 'production'
  ? 'https://...'
  : 'https://... or http://localhost'
if (!isMissing(env.NEXTAUTH_URL) && !isAllowedUrl(env.NEXTAUTH_URL)) {
  missing.push(`NEXTAUTH_URL=${requiredUrlDescription}`)
}
if (!isMissing(env.PAYMENT_PUBLIC_BASE_URL) && !isAllowedUrl(env.PAYMENT_PUBLIC_BASE_URL)) {
  missing.push(`PAYMENT_PUBLIC_BASE_URL=${requiredUrlDescription}`)
}

const trustedProxyHops = Number(env.TRUSTED_PROXY_HOPS)
if (validationMode === 'production') {
  if (!isMissing(env.TRUSTED_PROXY_HOPS) && (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops <= 0)) {
    missing.push('TRUSTED_PROXY_HOPS=positive-integer')
  }
} else if (!isMissing(env.TRUSTED_PROXY_HOPS) && (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0)) {
  missing.push('TRUSTED_PROXY_HOPS=non-negative-integer')
}

const bullBoardUserMissing = isMissing(env.BULL_BOARD_USER)
const bullBoardPasswordMissing = isMissing(env.BULL_BOARD_PASSWORD)
if (bullBoardUserMissing !== bullBoardPasswordMissing) {
  missing.push('BULL_BOARD_AUTH=both-user-and-password-or-neither')
}
if (!bullBoardPasswordMissing && isWeakSecret(env.BULL_BOARD_PASSWORD)) {
  missing.push('BULL_BOARD_PASSWORD=strong-secret-at-least-24-characters')
}
const bullBoardHost = env.BULL_BOARD_HOST || '127.0.0.1'
if (validationMode === 'development' && !isLoopbackHost(bullBoardHost) && (bullBoardUserMissing || bullBoardPasswordMissing)) {
  missing.push('BULL_BOARD_AUTH=required-for-non-loopback-host')
}

const requiredPlatformKeys = new Set()
const requiredPlatformBaseUrls = new Set()
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
  const platformBaseUrl = PLATFORM_BASE_URL_BY_PROVIDER[provider]
  if (platformBaseUrl) {
    requiredPlatformBaseUrls.add(platformBaseUrl)
  }
}

for (const key of requiredPlatformKeys) {
  if (isMissing(env[key])) {
    missing.push(key)
  }
}

for (const key of requiredPlatformBaseUrls) {
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
