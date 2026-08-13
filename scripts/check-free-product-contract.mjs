import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ACTIVE_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.txt'])
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
  'src/app/[locale]/pricing',
  'src/app/api/operation-approval-grants',
  'src/lib/query/use-asset-operation-billing-plan.ts',
  'src/lib/user-api/api-config-pricing-display.ts',
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
  'ApprovalGrant',
]
const FORBIDDEN_SCHEMA_FIELDS = [
  'assistantBillingConfirmationRequired',
  'billingInfo',
  'billedAt',
  'quoteSnapshot',
  'quoteHash',
  'quoteCeiling',
]
const FORBIDDEN_ACTIVE_SOURCE_PATTERNS = [
  { label: 'pricing catalog', pattern: /\bBUILTIN_PRICING_CATALOG_ENTRIES\b/u },
  { label: 'retail price state', pattern: /\bretail\s*:/u },
  { label: 'price conversion', pattern: /\busdToCredits\b/u },
  { label: 'assistant quote copy', pattern: /quoted ceiling|报价上限/iu },
  { label: 'legacy product pricing type', pattern: /\bVideoPricingTier\b/u },
  { label: 'legacy product budget field', pattern: /\bmaxBudgetCredits\b/u },
]
const FORBIDDEN_MESSAGE_PATTERNS = [
  { label: 'commercial message copy', pattern: /\b(?:stripe|pricing|retail|recharge|refund|billable|credits?)\b/iu },
  { label: 'commercial Chinese message copy', pattern: /(?:计费|价格|零售价|充值|退款|平台额度|余额不足)/u },
]
const ALLOWED_PROVIDER_MESSAGE_KEYS = new Set([
  'PROVIDER_BILLING_REQUIRED',
  'PLATFORM_PROVIDER_BILLING_REQUIRED',
])

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
  const absolutePath = path.join(rootDir, relativePath)
  if (!existsSync(absolutePath)) return false
  return !lstatSync(absolutePath).isDirectory() || readdirSync(absolutePath).length > 0
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
    for (const forbidden of FORBIDDEN_ACTIVE_SOURCE_PATTERNS) {
      if (forbidden.pattern.test(source)) {
        violations.push(`${forbidden.label}: ${relativePath}`)
      }
    }
  }

  for (const locale of ['en', 'zh']) {
    const directory = path.join(rootDir, 'messages', locale)
    if (!existsSync(directory)) continue
    for (const fileName of readdirSync(directory)) {
      if (!fileName.endsWith('.json')) continue
      const relativePath = path.join('messages', locale, fileName)
      const parsed = readJson(rootDir, relativePath)
      if (!parsed || parsed.__parseError) {
        violations.push(`invalid message catalog: ${relativePath}`)
        continue
      }
      const stack = [[parsed, '']]
      while (stack.length > 0) {
        const [value, keyPath] = stack.pop()
        if (typeof value === 'string') {
          const leafKey = keyPath.split('.').at(-1) || ''
          if (ALLOWED_PROVIDER_MESSAGE_KEYS.has(leafKey)) continue
          for (const forbidden of FORBIDDEN_MESSAGE_PATTERNS) {
            if (forbidden.pattern.test(value) || forbidden.pattern.test(keyPath)) {
              violations.push(`${forbidden.label}: ${relativePath}:${keyPath}`)
            }
          }
          continue
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        for (const [key, child] of Object.entries(value)) {
          stack.push([child, keyPath ? `${keyPath}.${key}` : key])
        }
      }
    }
  }

  for (const relativePath of ['docker-compose.yml', 'docker-compose.dev.yml']) {
    const absolutePath = path.join(rootDir, relativePath)
    if (existsSync(absolutePath) && /\bBILLING_MODE\b/u.test(readFileSync(absolutePath, 'utf8'))) {
      violations.push(`billing environment switch: ${relativePath}`)
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
