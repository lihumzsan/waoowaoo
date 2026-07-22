import path from 'node:path'
import { verifyVideoSeamAcceptance } from '../src/lib/video/video-seam-acceptance'

function invalidArguments(): never {
  throw new Error('VIDEO_SEAM_ACCEPTANCE_CLI_ARGUMENTS_INVALID')
}

function parseArguments(args: string[]): {
  input1Path: string
  input2Path: string
  outputPath: string
  resultPath: string
} {
  if (args.length !== 8) return invalidArguments()
  let input1Path: string | undefined
  let input2Path: string | undefined
  let outputPath: string | undefined
  let resultPath: string | undefined
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]
    const value = args[index + 1]
    if (!value || !path.isAbsolute(value)) return invalidArguments()
    if (option === '--input1' && input1Path === undefined) input1Path = value
    else if (option === '--input2' && input2Path === undefined) input2Path = value
    else if (option === '--output' && outputPath === undefined) outputPath = value
    else if (option === '--result' && resultPath === undefined) resultPath = value
    else return invalidArguments()
  }
  if (!input1Path || !input2Path || !outputPath || !resultPath) return invalidArguments()
  return { input1Path, input2Path, outputPath, resultPath }
}

function conciseErrorCode(error: unknown): string {
  if (error instanceof Error && /^VIDEO_SEAM_[A-Z0-9_]+$/.test(error.message)) {
    return error.message
  }
  return 'VIDEO_SEAM_ACCEPTANCE_FAILED'
}

async function main(): Promise<void> {
  const report = await verifyVideoSeamAcceptance(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

void main().catch((error: unknown) => {
  process.stderr.write(`${conciseErrorCode(error)}\n`)
  process.exitCode = 1
})
