import { parseE2eRunnerConfig } from './config'
import { formatE2eFailure } from './reporter'
import { runLongFormE2e } from './runner'

async function main(): Promise<void> {
  const config = parseE2eRunnerConfig()
  const result = await runLongFormE2e(config)
  const lines = [
    `status=${result.status}`,
    `target=${result.target}`,
    `projectId=${result.projectId ?? 'null'}`,
    `episodeId=${result.episodeId ?? 'null'}`,
    `workspaceUrl=${result.workspaceUrl ?? 'null'}`,
    `reportPath=${result.reportPath ?? 'null'}`,
    `elapsedMs=${String(result.elapsedMs)}`,
    `failure=${formatE2eFailure(result.failure)}`,
  ]
  console.log(lines.join('\n'))
  if (result.status === 'SYSTEM_FAIL') process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
