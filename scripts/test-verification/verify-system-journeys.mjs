#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const JOURNEY_PATTERN = /\[P0:([A-Z0-9-]+)\]/g
const VALID_STATUSES = new Set(['protected', 'scenario-required'])

export function validateSystemJourneyRegistry(registry) {
  if (!Array.isArray(registry) || registry.length < 10) {
    throw new Error(`P0 system journey registry must contain at least 10 journeys, received ${Array.isArray(registry) ? registry.length : 'non-array'}`)
  }
  const ids = registry.map((journey) => journey.id)
  if (ids.some((id) => typeof id !== 'string' || !/^SYS-[A-Z0-9-]+$/.test(id))) {
    throw new Error('P0 system journey ids must use the SYS-* contract')
  }
  if (new Set(ids).size !== ids.length) throw new Error('P0 system journey ids must be unique')
  const invalidStatus = registry.find((journey) => !VALID_STATUSES.has(journey.status))
  if (invalidStatus) throw new Error(`Unknown P0 system journey status: ${invalidStatus.status}`)
}

export function compareSystemJourneyExecution(report, registry) {
  validateSystemJourneyRegistry(registry)
  const protectedIds = registry.filter((journey) => journey.status === 'protected').map((journey) => journey.id).sort()
  const knownIds = new Set(registry.map((journey) => journey.id))
  const executedIds = []
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status !== 'passed') continue
      for (const match of (assertion.fullName ?? assertion.title ?? '').matchAll(JOURNEY_PATTERN)) {
        executedIds.push(match[1])
      }
    }
  }
  const executed = [...new Set(executedIds)].sort()
  return {
    protectedIds,
    executedIds: executed,
    missing: protectedIds.filter((id) => !executed.includes(id)),
    unexpected: executed.filter((id) => !knownIds.has(id) || !protectedIds.includes(id)),
    duplicates: executedIds.filter((id, index) => executedIds.indexOf(id) !== index),
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function main() {
  const reportPath = readOption('--report')
  const registryPath = readOption('--registry')
  if (!reportPath || !registryPath) throw new Error('--report and --registry are required')
  const report = JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8'))
  const registry = JSON.parse(fs.readFileSync(path.resolve(registryPath), 'utf8'))
  const result = compareSystemJourneyExecution(report, registry)
  if (result.missing.length || result.unexpected.length || result.duplicates.length) {
    throw new Error(`P0 system journey execution mismatch: ${JSON.stringify(result)}`)
  }
  console.log(`[verify-system-journeys] OK protected=${result.protectedIds.length} executed=${result.executedIds.length}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
