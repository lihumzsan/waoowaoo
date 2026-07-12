import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { GOLDEN_SCENARIO_CONTRACTS } from '../contracts/scenarios'

interface PlaywrightAttachment {
  readonly name: string
  readonly contentType: string
  readonly body?: string
  readonly path?: string
}

interface PlaywrightResult {
  readonly status?: string
  readonly error?: { readonly message?: string }
  readonly attachments?: readonly PlaywrightAttachment[]
}

interface PlaywrightTest {
  readonly status?: string
  readonly results?: readonly PlaywrightResult[]
}

interface PlaywrightSpec {
  readonly title: string
  readonly ok?: boolean
  readonly tests?: readonly PlaywrightTest[]
}

interface PlaywrightSuite {
  readonly title: string
  readonly suites?: readonly PlaywrightSuite[]
  readonly specs?: readonly PlaywrightSpec[]
}

function decodeAttachment<T>(attachments: readonly PlaywrightAttachment[], name: string): T | null {
  const attachment = attachments.find((candidate) => candidate.name === name)
  if (!attachment?.body) return null
  return JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')) as T
}

function decodeProductEvidence(attachments: readonly PlaywrightAttachment[]): Record<string, unknown> {
  return Object.fromEntries(attachments.flatMap((attachment) => {
    if (!attachment.name.startsWith('golden-') || !attachment.body) return []
    if (attachment.name === 'golden-browser-observations' || attachment.name.startsWith('golden-oracle')) return []
    try {
      return [[
        attachment.name,
        JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')) as unknown,
      ]]
    } catch {
      return []
    }
  }))
}

function flattenSuites(suites: readonly PlaywrightSuite[]): PlaywrightSuite[] {
  return suites.flatMap((suite) => [suite, ...flattenSuites(suite.suites ?? [])])
}

function classify(actual: string | null, errors: readonly string[]): 'pass' | 'product' | 'provider' | 'harness' | 'blocked' | 'unknown' {
  if (
    actual
    && actual !== 'assistant_failure'
    && actual !== 'interaction_failure'
    && actual !== 'render_failure'
    && actual !== 'timeout'
  ) return 'pass'
  const source = `${actual ?? ''}\n${errors.join('\n')}`
  if (/GOLDEN_STAGE_CHECKPOINT_MISSING/.test(source)) return 'blocked'
  if (/provider|OPENROUTER|FAL|ELEVENLABS/i.test(source)) return 'provider'
  if (/interaction_failure|render_failure|Maximum update depth|PROJECT_AGENT|assistant_failure/i.test(source)) return 'product'
  if (/GOLDEN_|oracle|fixture|provider contract/i.test(source)) return 'harness'
  return 'unknown'
}

function scenarioIdFromTitle(title: string): string | null {
  const match = title.match(/\[(GJ-[^\]]+)\]/)
  return match?.[1] ?? null
}

async function main(): Promise<void> {
  const root = path.resolve(process.cwd(), 'artifacts/golden-journey')
  const raw = JSON.parse(await readFile(path.join(root, 'playwright-results.json'), 'utf8')) as {
    readonly suites?: readonly PlaywrightSuite[]
    readonly stats?: unknown
  }
  const rows = flattenSuites(raw.suites ?? []).flatMap((suite) => (
    (suite.specs ?? []).map((spec) => {
      const results = (spec.tests ?? []).flatMap((test) => test.results ?? [])
      const attachments = results.flatMap((result) => result.attachments ?? [])
      const outcome = decodeAttachment<{ expected?: string; actual?: string }>(attachments, 'golden-stage-outcome')
      const browser = decodeAttachment<{
        consoleErrors?: readonly { text?: string }[]
        pageErrors?: readonly { message?: string }[]
        failedRequests?: readonly unknown[]
        errorResponses?: readonly unknown[]
      }>(attachments, 'golden-browser-observations')
      const oracleAttachment = attachments.find((attachment) => attachment.name.startsWith('golden-oracle'))
      const oracle = oracleAttachment?.body
        ? JSON.parse(Buffer.from(oracleAttachment.body, 'base64').toString('utf8')) as {
          runs?: readonly Record<string, unknown>[]
          activities?: readonly Record<string, unknown>[]
          interruptions?: readonly Record<string, unknown>[]
          waits?: readonly unknown[]
          tasks?: readonly Record<string, unknown>[]
          identities?: unknown
        }
        : null
      const errors = [
        ...results.flatMap((result) => result.error?.message ? [result.error.message] : []),
        ...(browser?.consoleErrors ?? []).flatMap((item) => item.text ? [item.text] : []),
        ...(browser?.pageErrors ?? []).flatMap((item) => item.message ? [item.message] : []),
      ]
      const scenarioId = scenarioIdFromTitle(spec.title)
      const contract = GOLDEN_SCENARIO_CONTRACTS.find((candidate) => candidate.id === scenarioId)
      const declaredExpected = contract?.expectedTerminal.kind === 'workflow_stage'
        ? contract.expectedTerminal.stage
        : contract?.expectedTerminal.kind === 'declared_failure'
          ? contract.expectedTerminal.code
          : contract?.expectedTerminal.fact ?? null
      const blockedMatch = errors.join('\n').match(/GOLDEN_MAINLINE_BLOCKED:([^:]+)/)
      const derivedActual = outcome?.actual
        ?? blockedMatch?.[1]
        ?? (spec.ok ? 'passed' : null)
      const observedStages = attachments
        .map((attachment) => attachment.name.match(/^stage-\d+-(.+)$/)?.[1] ?? null)
        .filter((stage): stage is string => stage !== null)
      return {
        suite: suite.title,
        scenario: spec.title,
        scenarioId,
        passed: spec.ok === true,
        expected: outcome?.expected ?? declaredExpected,
        actual: derivedActual,
        classification: classify(derivedActual, errors),
        errors,
        observedStages,
        browser: browser ?? null,
        productEvidence: decodeProductEvidence(attachments),
        oracle: oracle ? {
          runs: oracle.runs?.map((run) => ({
            id: run.id,
            status: run.status,
            stopReason: run.stopReason,
            errorCode: run.errorCode,
            errorMessage: run.errorMessage,
          })) ?? [],
          activities: oracle.activities?.map((activity) => ({
            operationId: activity.operationId,
            status: activity.status,
            errorCode: activity.errorCode,
          })) ?? [],
          interruptions: oracle.interruptions?.map((interruption) => ({
            type: interruption.type,
            status: interruption.status,
            operationId: interruption.operationId,
          })) ?? [],
          waitCount: oracle.waits?.length ?? 0,
          tasks: oracle.tasks?.map((task) => ({
            type: task.type,
            status: task.status,
            errorCode: task.errorCode,
          })) ?? [],
          identities: oracle.identities ?? null,
        } : null,
        artifactPaths: attachments.flatMap((attachment) => attachment.path ? [attachment.path] : []),
      }
    })
  ))
  const environment = JSON.parse(await readFile(path.join(root, 'environment.json'), 'utf8')) as unknown
  const report = {
    generatedAt: new Date().toISOString(),
    environment,
    stats: raw.stats ?? null,
    rows,
  }
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'diagnostic-matrix.json'), JSON.stringify(report, null, 2))
  const markdown = [
    '# Product Golden Journey diagnostic matrix',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Scenario | Expected | Actual | Class | Result |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.scenario.replaceAll('|', '\\|')} | ${row.expected ?? '-'} | ${row.actual ?? '-'} | ${row.classification} | ${row.passed ? 'PASS' : 'FAIL'} |`),
    '',
  ].join('\n')
  await writeFile(path.join(root, 'diagnostic-matrix.md'), markdown)
  const runId = process.env.GOLDEN_RUN_ID?.trim()
    || report.generatedAt.replaceAll(':', '-').replaceAll('.', '-')
  const runRoot = path.join(root, 'runs', runId)
  await mkdir(runRoot, { recursive: true })
  await Promise.all([
    writeFile(path.join(runRoot, 'diagnostic-matrix.json'), JSON.stringify(report, null, 2)),
    writeFile(path.join(runRoot, 'diagnostic-matrix.md'), markdown),
  ])
  const historyPath = path.join(root, 'diagnostic-history.json')
  let history: readonly unknown[] = []
  try {
    const value = JSON.parse(await readFile(historyPath, 'utf8')) as unknown
    if (Array.isArray(value)) history = value
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  await writeFile(historyPath, JSON.stringify([
    ...history,
    { runId, ...report },
  ], null, 2))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
