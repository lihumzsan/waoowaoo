#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function fingerprint(fileName, mutant) {
  const start = mutant.location?.start
  const end = mutant.location?.end
  return [
    fileName,
    mutant.mutatorName,
    `${start?.line ?? 0}:${start?.column ?? 0}-${end?.line ?? 0}:${end?.column ?? 0}`,
    mutant.replacement ?? '',
  ].join('|')
}

export function collectSurvivingMutants(report) {
  const survivors = []
  for (const [fileName, fileResult] of Object.entries(report.files ?? {})) {
    for (const mutant of fileResult.mutants ?? []) {
      if (mutant.status !== 'Survived' && mutant.status !== 'NoCoverage') continue
      survivors.push({
        fingerprint: fingerprint(fileName, mutant),
        fileName,
        status: mutant.status,
        mutatorName: mutant.mutatorName,
        location: mutant.location,
      })
    }
  }
  return survivors.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint))
}

export function compareMutationBaseline(report, baseline) {
  const current = collectSurvivingMutants(report)
  const accepted = new Set(baseline.acceptedFingerprints ?? [])
  return {
    current,
    newSurvivors: current.filter((mutant) => !accepted.has(mutant.fingerprint)),
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    args.set(argv[index], argv[index + 1])
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const reportPath = args.get('--report')
  const baselinePath = args.get('--baseline')
  const printBaseline = args.has('--print-baseline')
  const writeBaselinePath = args.get('--write-baseline')
  if (!reportPath) throw new Error('--report is required')

  const report = readJson(path.resolve(reportPath))
  const generatedBaseline = {
      schemaVersion: 1,
      acceptedFingerprints: collectSurvivingMutants(report).map((mutant) => mutant.fingerprint),
  }
  if (printBaseline) {
    process.stdout.write(`${JSON.stringify(generatedBaseline, null, 2)}\n`)
    return
  }
  if (writeBaselinePath) {
    const resolvedBaselinePath = path.resolve(writeBaselinePath)
    fs.mkdirSync(path.dirname(resolvedBaselinePath), { recursive: true })
    fs.writeFileSync(resolvedBaselinePath, `${JSON.stringify(generatedBaseline, null, 2)}\n`)
    console.log(`[mutation-baseline] wrote ${generatedBaseline.acceptedFingerprints.length} accepted fingerprints to ${writeBaselinePath}`)
    return
  }
  if (!baselinePath) throw new Error('--baseline is required unless --print-baseline or --write-baseline is used')
  if (!fs.existsSync(path.resolve(baselinePath))) {
    throw new Error(`Mutation baseline is missing: ${baselinePath}`)
  }
  const comparison = compareMutationBaseline(report, readJson(path.resolve(baselinePath)))
  if (comparison.newSurvivors.length > 0) {
    console.error(`[mutation-baseline] new surviving mutants=${comparison.newSurvivors.length}`)
    for (const mutant of comparison.newSurvivors) console.error(`  - ${mutant.fingerprint}`)
    process.exitCode = 1
    return
  }
  console.log(`[mutation-baseline] OK surviving=${comparison.current.length} new=0`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
