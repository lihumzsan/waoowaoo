import type { BehaviorScenario } from './behavior-scenario'

export type HistoricalRegressionScenario = BehaviorScenario<string> & {
  readonly defectId: string
  readonly verifyFailBefore: () => Promise<void>
}

export class HistoricalBusinessAssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HistoricalBusinessAssertionError'
  }
}

export function assertHistoricalValue<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new HistoricalBusinessAssertionError(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    )
  }
}

export async function proveSemanticFaultRejected(runFault: () => void | Promise<void>): Promise<void> {
  try {
    await runFault()
  } catch (error) {
    if (error instanceof HistoricalBusinessAssertionError) return
    throw new Error(
      `Semantic fault failed for an unrelated reason: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  throw new Error('Semantic fault survived the historical business assertion')
}

export async function assertHistoricalThrows(
  action: () => unknown | Promise<unknown>,
  expectedMessage: string,
  label: string,
): Promise<void> {
  try {
    await action()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes(expectedMessage)) return
    throw new HistoricalBusinessAssertionError(
      `${label}: expected error containing ${expectedMessage}, received ${message}`,
    )
  }
  throw new HistoricalBusinessAssertionError(`${label}: expected action to throw`)
}
