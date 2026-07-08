import fs from 'node:fs/promises'
import path from 'node:path'
import type { E2eDiagnostics } from './diagnostics-types'
import type { E2eFailure, E2eRunnerConfig, E2eRunResult } from './types'

export interface E2eReport {
  readonly generatedAt: string
  readonly config: {
    readonly mode: E2eRunnerConfig['mode']
    readonly target: E2eRunnerConfig['target']
    readonly generation: E2eRunnerConfig['generation']
    readonly baseUrl: string
    readonly locale: E2eRunnerConfig['locale']
  }
  readonly result: Omit<E2eRunResult, 'reportPath'>
  readonly diagnostics: E2eDiagnostics | null
}

function buildReportFileName(input: {
  readonly projectId: string | null
  readonly episodeId: string | null
  readonly target: string
}): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const project = input.projectId ?? 'no-project'
  const episode = input.episodeId ?? 'no-episode'
  return `${timestamp}-${input.target}-${project}-${episode}.json`
}

export async function writeE2eReport(input: {
  readonly config: E2eRunnerConfig
  readonly result: Omit<E2eRunResult, 'reportPath'>
  readonly diagnostics: E2eDiagnostics | null
}): Promise<string> {
  await fs.mkdir(input.config.reportDir, { recursive: true })
  const filePath = path.join(input.config.reportDir, buildReportFileName({
    projectId: input.result.projectId,
    episodeId: input.result.episodeId,
    target: input.config.target,
  }))
  const report: E2eReport = {
    generatedAt: new Date().toISOString(),
    config: {
      mode: input.config.mode,
      target: input.config.target,
      generation: input.config.generation,
      baseUrl: input.config.baseUrl,
      locale: input.config.locale,
    },
    result: input.result,
    diagnostics: input.diagnostics,
  }
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf8')
  return filePath
}

export function formatE2eFailure(failure: E2eFailure | null): string {
  if (!failure) return 'none'
  return `${failure.status}:${failure.code}:${failure.message}`
}
