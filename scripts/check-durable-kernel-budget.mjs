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
  'src/lib/agent-turn/follow-up-batch.ts',
  ...sourceFilesUnder('src/lib/temporal'),
  'src/lib/operations/durable-dispatch.ts',
]

const safetyLedgers = [
  'src/lib/agent-turn/effect-fence.ts',
  'src/lib/agent-turn/tool-effect.ts',
  ...sourceFilesUnder('src/lib/task/terminal'),
  'src/lib/task/provider-invocation.ts',
  'src/lib/task/execution-checkpoint.ts',
  'src/lib/operations/durable-execution.ts',
]

const productAdapters = [
  'src/lib/agent-turn/stream-publisher.ts',
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
    .replaceAll('\\', '/')
  if (normalized !== file) {
    throw new Error(`DURABLE_BUDGET_PATH_DIVERGED:${file}:${normalized}`)
  }
}
