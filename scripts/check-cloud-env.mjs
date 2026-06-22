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

const PLATFORM_KEY_GROUP = [
  'PLATFORM_GOOGLE_API_KEY',
  'PLATFORM_FAL_API_KEY',
  'PLATFORM_ARK_API_KEY',
  'PLATFORM_OPENROUTER_API_KEY',
]

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

const hasPlatformKey = PLATFORM_KEY_GROUP.some((key) => !isMissing(env[key]))
if (!hasPlatformKey) {
  missing.push(`one of ${PLATFORM_KEY_GROUP.join(',')}`)
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
