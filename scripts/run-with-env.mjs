#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

function parseEnvLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const equalsIndex = trimmed.indexOf('=')
  if (equalsIndex <= 0) return null

  const key = trimmed.slice(0, equalsIndex).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`ENV_KEY_INVALID:${key}`)
  }

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

const cliArgs = process.argv.slice(2)
const separatorIndex = cliArgs.indexOf('--')
const envFiles = separatorIndex >= 0 ? cliArgs.slice(0, separatorIndex) : cliArgs.slice(0, 1)
const commandArgs = separatorIndex >= 0 ? cliArgs.slice(separatorIndex + 1) : cliArgs.slice(1)
const [command, ...args] = commandArgs

if (envFiles.length === 0 || !command) {
  console.error('Usage: node scripts/run-with-env.mjs <env-file> [<env-file> ...] -- <command> [...args]')
  process.exit(2)
}

const env = {
  ...process.env,
}
for (const envFile of envFiles) {
  Object.assign(env, readEnvFile(envFile))
}

const result = spawnSync(command, args, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
