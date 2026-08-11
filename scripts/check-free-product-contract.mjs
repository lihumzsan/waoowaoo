import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ACTIVE_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const FORBIDDEN_ACTIVE_PATHS = [
  'src/lib/billing',
  'src/lib/payments',
  'src/lib/paid-beta',
  'src/app/api/payments',
  'src/app/api/paid-beta',
  'src/app/api/user/transactions',
  'src/app/api/user/costs',
  'src/app/api/projects/[projectId]/costs',
  'src/app/[locale]/_pricing-glass',
  'src/components/billing',
  'src/components/paid-beta',
]
const FORBIDDEN_SCHEMA_NAMES = [
  'UsageCost',
  'UserBalance',
  'LlmBillingMeter',
  'Subscription',
  'SubscriptionGrant',
  'BalanceFreeze',
  'BalanceTransaction',
  'PaidBetaCampaign',
  'PaidBetaSeat',
  'PaidBetaPaymentAttempt',
]
const FORBIDDEN_SCHEMA_FIELDS = [
  'assistantBillingConfirmationRequired',
  'billingInfo',
  'billedAt',
  'quoteSnapshot',
  'quoteHash',
  'quoteCeiling',
]

function readJson(rootDir, relativePath) {
  const absolutePath = path.join(rootDir, relativePath)
  if (!existsSync(absolutePath)) return null
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'))
  } catch (error) {
    return { __parseError: error instanceof Error ? error.message : String(error) }
  }
}

function walkActiveSources(rootDir, current = 'src', output = []) {
  const directory = path.join(rootDir, current)
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) return output
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(current, entry.name)
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    if (entry.isDirectory()) {
      walkActiveSources(rootDir, relativePath, output)
      continue
    }
    if (ACTIVE_SOURCE_EXTENSIONS.has(path.extname(entry.name))) output.push(relativePath)
  }
  return output
}

function hasActivePath(rootDir, relativePath) {
  return existsSync(path.join(rootDir, relativePath))
}

function checkFreeProductContract({ rootDir }) {
  const violations = []

  for (const relativePath of FORBIDDEN_ACTIVE_PATHS) {
    if (hasActivePath(rootDir, relativePath)) {
      const category = relativePath.startsWith('src/app/api/')
        ? 'payment route'
        : 'active billing directory'
      violations.push(`${category}: ${relativePath}`)
    }
  }

  const packageJson = readJson(rootDir, 'package.json')
  if (!packageJson || packageJson.__parseError) {
    violations.push('package.json is missing or invalid')
  } else {
    const dependencies = {
      ...(typeof packageJson.dependencies === 'object' ? packageJson.dependencies : {}),
      ...(typeof packageJson.devDependencies === 'object' ? packageJson.devDependencies : {}),
      ...(typeof packageJson.optionalDependencies === 'object' ? packageJson.optionalDependencies : {}),
    }
    for (const dependency of ['stripe', '@stripe/stripe-js']) {
      if (Object.prototype.hasOwnProperty.call(dependencies, dependency)) {
        violations.push(`Stripe dependency: ${dependency}`)
      }
    }
    if (packageJson.scripts && typeof packageJson.scripts === 'object') {
      for (const scriptName of Object.keys(packageJson.scripts)) {
        if (/(billing|pricing|payment|reconcile|credit)/iu.test(scriptName)) {
          violations.push(`billing script: ${scriptName}`)
        }
      }
    }
  }

  const schemaPath = path.join(rootDir, 'prisma/schema.prisma')
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, 'utf8')
    for (const modelName of FORBIDDEN_SCHEMA_NAMES) {
      if (new RegExp(`\\bmodel\\s+${modelName}\\b`, 'u').test(schema)) {
        violations.push(`forbidden Prisma model: ${modelName}`)
      }
    }
    for (const fieldName of FORBIDDEN_SCHEMA_FIELDS) {
      if (new RegExp(`^\\s*${fieldName}\\s+`, 'mu').test(schema)) {
        violations.push(`forbidden Prisma field: ${fieldName}`)
      }
    }
  }

  for (const relativePath of walkActiveSources(rootDir)) {
    const source = readFileSync(path.join(rootDir, relativePath), 'utf8')
    if (/@\/lib\/billing|@\/lib\/payments|from\s+['"](?:stripe|@stripe\/stripe-js)['"]/u.test(source)) {
      violations.push(`billing import: ${relativePath}`)
    }
  }

  return { violations: [...new Set(violations)].sort() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = checkFreeProductContract({ rootDir: process.cwd() })
  if (result.violations.length > 0) {
    for (const violation of result.violations) process.stderr.write(`[check-free-product-contract] ${violation}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('[check-free-product-contract] OK\n')
  }
}

export { checkFreeProductContract }
