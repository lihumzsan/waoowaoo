import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import {
  EXTERNAL_OPERATION,
  EXTERNAL_OPERATION_REGISTRY,
  type ExternalOperationContract,
  type ExternalOperationId,
} from '@/lib/external-operation/registry'
import { FAILURE_RECORD_VERSION } from '@/lib/errors/failure'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { projectErrorForModel } from '@/lib/errors/projection'
import { TEMPORAL_FAILURE_PROTOCOL } from '@/lib/temporal/failure'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')

function listSourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listSourceFiles(absolute))
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(absolute)
  }
  return files
}

function containsIdentifier(node: ts.Node, identifier: string): boolean {
  let found = false
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current) && current.text === identifier) found = true
    if (!found) ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function carriesCaughtValue(expression: ts.NewExpression, identifier: string): boolean {
  const hasCauseProperty = (node: ts.Node): boolean => {
    let found = false
    const visit = (current: ts.Node): void => {
      if (
        ts.isPropertyAssignment(current)
        && (
          ts.isIdentifier(current.name) && current.name.text === 'cause'
          || ts.isStringLiteral(current.name) && current.name.text === 'cause'
        )
        && containsIdentifier(current.initializer, identifier)
      ) {
        found = true
        return
      }
      if (!found) ts.forEachChild(current, visit)
    }
    visit(node)
    return found
  }
  for (const argument of expression.arguments ?? []) {
    if (ts.isIdentifier(argument) && argument.text === identifier) return true
    if (
      ts.isArrayLiteralExpression(argument)
      && argument.elements.some((element) => ts.isIdentifier(element) && element.text === identifier)
    ) return true
    if (hasCauseProperty(argument)) return true
  }
  return false
}

function findLossyCatchWrappers(file: string, source: string): readonly number[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCatchClause(node)
      && node.variableDeclaration
      && ts.isIdentifier(node.variableDeclaration.name)
    ) {
      const identifier = node.variableDeclaration.name.text
      const inspectCatchBody = (current: ts.Node): void => {
        if (current !== node.block && ts.isCatchClause(current)) return
        const thrownConstruction = ts.isThrowStatement(current) && current.expression
          ? ts.isNewExpression(current.expression)
            ? current.expression
            : ts.isCallExpression(current.expression)
              && ts.isPropertyAccessExpression(current.expression.expression)
              && current.expression.expression.expression.getText(sourceFile) === 'Object'
              && current.expression.expression.name.text === 'assign'
              && current.expression.arguments[0]
              && ts.isNewExpression(current.expression.arguments[0])
                ? current.expression.arguments[0]
                : null
          : null
        if (thrownConstruction && !carriesCaughtValue(thrownConstruction, identifier)) {
          lines.push(sourceFile.getLineAndCharacterOfPosition(current.getStart()).line + 1)
        }
        ts.forEachChild(current, inspectCatchBody)
      }
      inspectCatchBody(node.block)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return lines
}

function requireContract(
  id: ExternalOperationId,
  expected: Partial<ExternalOperationContract>,
  violations: string[],
): void {
  const actual = EXTERNAL_OPERATION_REGISTRY[id]
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key as keyof ExternalOperationContract] !== value) {
      violations.push(`${id}.${key} must be ${String(value)}`)
    }
  }
}

const violations: string[] = []
const ids = Object.values(EXTERNAL_OPERATION)
const registryIds = Object.keys(EXTERNAL_OPERATION_REGISTRY)
if (new Set(ids).size !== ids.length) violations.push('external operation identities must be unique')
if (ids.length !== registryIds.length || ids.some((id) => !(id in EXTERNAL_OPERATION_REGISTRY))) {
  violations.push('external operation registry must exhaust every declared identity')
}
for (const id of ids) {
  const contract = EXTERNAL_OPERATION_REGISTRY[id]
  if (!Number.isSafeInteger(contract.maxAttempts) || contract.maxAttempts < 1) {
    violations.push(`${id}.maxAttempts must be a positive integer`)
  }
  if (contract.replay === 'forbidden' && contract.maxAttempts !== 1) {
    violations.push(`${id} forbids replay and therefore must have exactly one attempt`)
  }
  if (contract.replay === 'idempotent' && contract.taskReplay !== 'safe') {
    violations.push(`${id} is idempotent but does not permit the same Task operation to resume`)
  }
}
requireContract(EXTERNAL_OPERATION.PROVIDER_SUBMIT, {
  replay: 'forbidden',
  effectOnFailure: 'unknown',
  taskReplay: 'forbidden',
}, violations)
requireContract(EXTERNAL_OPERATION.ASSISTANT_FOLLOW_UP_DELIVERY, {
  replay: 'idempotent',
  taskReplay: 'safe',
}, violations)
requireContract(EXTERNAL_OPERATION.STORAGE_PUT_SAME_OBJECT, {
  replay: 'idempotent',
  taskReplay: 'safe',
}, violations)
requireContract(EXTERNAL_OPERATION.PROVIDER_POLL, {
  replay: 'idempotent',
  effectOnFailure: 'none',
}, violations)
requireContract(EXTERNAL_OPERATION.MEDIA_DOWNLOAD_POLICY, {
  replay: 'forbidden',
  effectOnFailure: 'none',
  taskReplay: 'forbidden',
}, violations)
requireContract(EXTERNAL_OPERATION.PROVIDER_CANCEL, {
  replay: 'idempotent',
  taskReplay: 'safe',
}, violations)

const unseenStorageError = Object.assign(new Error('User network is too slow'), {
  name: 'FutureStorageFailure',
  code: 'COS_ERROR_NOT_IN_ANY_CATALOG',
  statusCode: 503,
  requestId: 'cos-request-1',
  authorization: 'secret-must-not-leak',
  cause: { name: 'SocketFailure', message: 'connection reset', code: 'ECONNRESET' },
})
const storageFailure = normalizeAnyError(unseenStorageError, {
  operation: EXTERNAL_OPERATION.STORAGE_PUT_SAME_OBJECT,
  context: { system: 'application', phase: 'storage-write' },
  attempts: 3,
})
const storageProjection = projectErrorForModel(storageFailure)
const projectedNative = storageProjection.details.native as Record<string, unknown> | undefined
if (
  storageFailure.native.name !== 'FutureStorageFailure'
  || storageFailure.native.code !== 'COS_ERROR_NOT_IN_ANY_CATALOG'
  || storageFailure.native.statusCode !== 503
  || storageFailure.native.requestId !== 'cos-request-1'
  || storageFailure.native.cause?.code !== 'ECONNRESET'
  || storageFailure.recovery.taskReplay !== 'safe'
  || projectedNative?.message !== 'User network is too slow'
  || projectedNative?.code !== 'COS_ERROR_NOT_IN_ANY_CATALOG'
  || !projectedNative?.metadata
  || !projectedNative?.cause
) {
  violations.push('an unseen storage failure must preserve native evidence through the model projection')
}
if (JSON.stringify(storageProjection).includes('secret-must-not-leak')) {
  violations.push('model failure projection leaked a credential-bearing native field')
}
const outerWrappedStorageFailure = normalizeAnyError(
  Object.assign(new Error('outer workflow wrapper'), { failure: storageFailure }),
  {
    operation: EXTERNAL_OPERATION.TEMPORAL_TASK_ACTIVITY,
    context: { system: 'temporal', phase: 'task-activity' },
  },
)
if (
  outerWrappedStorageFailure.recovery.operation !== EXTERNAL_OPERATION.STORAGE_PUT_SAME_OBJECT
  || outerWrappedStorageFailure.recovery.taskReplay !== 'safe'
) {
  violations.push('an outer wrapper changed the original failing operation or its replay fact')
}
const unknownSubmitFailure = normalizeAnyError(unseenStorageError, {
  operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
  context: { system: 'provider', provider: 'future-provider', phase: 'submit' },
})
if (
  unknownSubmitFailure.recovery.effect !== 'unknown'
  || unknownSubmitFailure.recovery.taskReplay !== 'forbidden'
) {
  violations.push('an unknown provider submission outcome must never authorize replay')
}

if (FAILURE_RECORD_VERSION !== 2) violations.push('FailureRecord must have one live v2 parser')
if (TEMPORAL_FAILURE_PROTOCOL !== 'wao.failure.v2') {
  violations.push('Temporal must transport only the v2 failure protocol')
}

const forbidden = [
  ['legacy failure class', /\b(?:ERROR_FAILURE_CLASS|ErrorFailureClass|getErrorFailureClass|PERMANENT_PROVIDER|TRANSIENT_PROVIDER)\b/gu],
  ['caller-owned retry policy', /\b(?:RETRY_POLICY|RetryPolicy|computeRetryDelayMs)\b/gu],
  ['storage retry allowlist', /\b(?:RETRYABLE_STORAGE_ERROR_IDENTITIES|RETRYABLE_STORAGE_HTTP_STATUSES|normalizeS3OperationError|StorageOperationError)\b/gu],
  ['v1 temporal protocol', /wao\.failure\.v1/gu],
  ['legacy provider retry disposition', /\b(?:failureDisposition|retryable_rejected)\b/gu],
] as const

const providerReplayAuthorityOwners = new Map<string, ReadonlySet<string>>([
  [
    'PROVIDER_SUBMIT_REPLAY_AUTHORIZED',
    new Set([
      'src/lib/ai-exec/engine.ts',
      'src/lib/task/execution/provider-media.ts',
      'src/lib/task/provider-invocation.ts',
    ]),
  ],
])

for (const file of listSourceFiles(sourceRoot)) {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const source = fs.readFileSync(file, 'utf8')
  for (const line of findLossyCatchWrappers(file, source)) {
    violations.push(`${relative}:${String(line)} replaces a caught failure without carrying its evidence`)
  }
  for (const [label, pattern] of forbidden) {
    pattern.lastIndex = 0
    if (pattern.test(source)) violations.push(`${relative} contains ${label}`)
  }
  for (const [identity, owners] of providerReplayAuthorityOwners) {
    if (
      source.includes(`EXTERNAL_OPERATION.${identity}`)
      && relative !== 'src/lib/external-operation/registry.ts'
      && !owners.has(relative)
    ) {
      violations.push(`${relative} uses ${identity} outside its durable effect owner`)
    }
  }
  if (
    relative !== 'src/lib/external-operation/registry.ts'
    && /provider\.submit\.replay-authorized/gu.test(source)
  ) {
    violations.push(`${relative} spells a replay-authorized provider identity outside the registry`)
  }
  if (
    (
      relative.startsWith('src/lib/ai-providers/')
      || relative.startsWith('src/lib/retry/')
      || relative.startsWith('src/lib/storage/')
      || relative.startsWith('src/lib/task/')
    )
    && /getErrorSpec\([^)]*\)\.retryable|\bspec\.retryable\b/gu.test(source)
  ) {
    violations.push(`${relative} lets a product error code authorize execution replay`)
  }
  if (
    source.includes("from '@aws-sdk/client-s3'")
    && relative !== 'src/lib/storage/providers/s3.ts'
    && relative !== 'src/lib/storage/s3-config.ts'
  ) {
    violations.push(`${relative} imports the object-storage SDK outside its sole adapter`)
  }
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(
  `Failure governance passed (${String(ids.length)} closed operations, v2 evidence and Temporal protocol).\n`,
)
