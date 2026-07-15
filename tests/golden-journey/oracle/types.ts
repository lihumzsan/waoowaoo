import type { GoldenWorkspaceScope } from '../browser/pages/home'

export interface GoldenOracleIdentitySummary {
  readonly messageIds: readonly string[]
  readonly duplicateMessageIds: readonly string[]
  readonly toolCallIds: readonly string[]
  readonly duplicateToolCallIds: readonly string[]
}

export interface GoldenOracleSnapshot {
  readonly capturedAt: string
  readonly scope: GoldenWorkspaceScope
  readonly project: Record<string, unknown> | null
  readonly episode: Record<string, unknown> | null
  readonly runs: readonly Record<string, unknown>[]
  readonly activities: readonly Record<string, unknown>[]
  readonly interruptions: readonly Record<string, unknown>[]
  readonly waits: readonly Record<string, unknown>[]
  readonly handoffs: readonly Record<string, unknown>[]
  readonly checkpoints: readonly Record<string, unknown>[]
  readonly events: readonly Record<string, unknown>[]
  readonly tasks: readonly Record<string, unknown>[]
  readonly taskEvents: readonly Record<string, unknown>[]
  readonly approvalGrants: readonly Record<string, unknown>[]
  readonly operationExecutions: readonly Record<string, unknown>[]
  readonly outboxCommands: readonly Record<string, unknown>[]
  readonly threads: readonly Record<string, unknown>[]
  readonly domain: {
    readonly sourceDocuments: readonly Record<string, unknown>[]
    readonly bibles: readonly Record<string, unknown>[]
    readonly stylePreviews: readonly Record<string, unknown>[]
    readonly chapters: readonly Record<string, unknown>[]
    readonly editScripts: readonly Record<string, unknown>[]
    readonly shotExecutionPlans: readonly Record<string, unknown>[]
    readonly videoSegments: readonly Record<string, unknown>[]
    readonly assetRequirements: readonly Record<string, unknown>[]
    readonly bgmDesigns: readonly Record<string, unknown>[]
    readonly musicScores: readonly Record<string, unknown>[]
    readonly finalOutputs: readonly Record<string, unknown>[]
  }
  readonly identities: GoldenOracleIdentitySummary
}
