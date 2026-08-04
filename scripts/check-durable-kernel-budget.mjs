import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const targetMax = 11_000
const hardReviewLine = 12_000

function sourceFilesUnder(path) {
  const absolute = resolve(repositoryRoot, path)
  if (!existsSync(absolute)) {
    throw new Error(`DURABLE_BUDGET_PATH_MISSING:${path}`)
  }
  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => {
      const child = `${path}/${entry.name}`
      if (entry.isDirectory()) return sourceFilesUnder(child)
      return entry.isFile() && /\.tsx?$/.test(entry.name) ? [child] : []
    })
    .sort()
}

const kernel = [
  'src/lib/agent-turn/approval-history.ts',
  'src/lib/agent-turn/approval.ts',
  'src/lib/agent-turn/choice.ts',
  'src/lib/agent-turn/contracts.ts',
  'src/lib/agent-turn/follow-up-batch.ts',
  'src/lib/agent-turn/identity.ts',
  'src/lib/agent-turn/lifecycle.ts',
  'src/lib/agent-turn/runtime-contract.ts',
  'src/lib/agent-turn/service.ts',
  ...sourceFilesUnder('src/lib/temporal'),
  'src/lib/operations/durable-dispatch.ts',
]

const safetyLedgers = [
  'src/lib/agent-turn/tool-effect.ts',
  'src/lib/agent-turn/usage.ts',
  ...sourceFilesUnder('src/lib/task/terminal'),
  'src/lib/task/provider-invocation.ts',
  'src/lib/task/execution-checkpoint.ts',
  'src/lib/operations/durable-execution.ts',
]

const productAdapters = [
  'src/lib/agent-turn/interrupted-effect-digest.ts',
  'src/lib/agent-turn/model-session.ts',
  'src/lib/agent-turn/runner-input.ts',
  'src/lib/agent-turn/runner.ts',
  'src/lib/agent-turn/stream-publisher.ts',
  'src/lib/agent-turn/tools.ts',
  'src/lib/agent-turn/user-evidence.ts',
  'src/lib/agent-turn/view-contract.ts',
  'src/lib/agent-turn/view.ts',
  'src/lib/operations/mutation-receipt.ts',
]

const relevant = [
  ...sourceFilesUnder('src/lib/agent-turn'),
  ...sourceFilesUnder('src/lib/temporal'),
  ...sourceFilesUnder('src/lib/task/terminal'),
  'src/lib/task/provider-invocation.ts',
  'src/lib/task/execution-checkpoint.ts',
  'src/lib/operations/durable-dispatch.ts',
  'src/lib/operations/durable-execution.ts',
  'src/lib/operations/mutation-receipt.ts',
]

function requireUniqueClassification() {
  const owners = new Map()
  for (const [classification, files] of [
    ['kernel', kernel],
    ['safety-ledger', safetyLedgers],
    ['product-adapter', productAdapters],
  ]) {
    for (const file of files) {
      const existing = owners.get(file)
      if (existing) {
        throw new Error(
          `DURABLE_BUDGET_CLASSIFICATION_OVERLAP:${file}:${existing}:${classification}`,
        )
      }
      owners.set(file, classification)
    }
  }
  const unclassified = relevant.filter((file) => !owners.has(file))
  const missing = [...owners.keys()].filter((file) => !relevant.includes(file))
  if (unclassified.length > 0 || missing.length > 0) {
    throw new Error(
      [
        'DURABLE_BUDGET_CLASSIFICATION_INCOMPLETE',
        `unclassified=${unclassified.join(',') || 'none'}`,
        `missing=${missing.join(',') || 'none'}`,
      ].join(':'),
    )
  }
}

function physicalLines(file) {
  const absolute = resolve(repositoryRoot, file)
  const source = readFileSync(absolute, 'utf8')
  if (!source) return 0
  const lines = source.split(/\r?\n/)
  return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

function total(files) {
  return files.reduce((sum, file) => sum + physicalLines(file), 0)
}

requireUniqueClassification()

const kernelLines = total(kernel)
const safetyLedgerLines = total(safetyLedgers)
const productAdapterLines = total(productAdapters)
const rawLines = kernelLines + safetyLedgerLines + productAdapterLines

console.log(
  [
    `durable-kernel=${kernelLines}`,
    `safety-ledgers=${safetyLedgerLines}`,
    `product-adapters=${productAdapterLines}`,
    `raw-related=${rawLines}`,
    `classified-files=${relevant.length}`,
  ].join(' '),
)

if (kernelLines >= hardReviewLine) {
  throw new Error(
    `DURABLE_KERNEL_HARD_REVIEW_REQUIRED:${kernelLines}:${hardReviewLine}`,
  )
}
if (kernelLines > targetMax) {
  console.warn(
    `DURABLE_KERNEL_TARGET_EXCEEDED:${kernelLines}:${targetMax}`,
  )
}

for (const file of relevant) {
  const normalized = relative(repositoryRoot, resolve(repositoryRoot, file))
  if (normalized !== file) {
    throw new Error(`DURABLE_BUDGET_PATH_DIVERGED:${file}:${normalized}`)
  }
}
