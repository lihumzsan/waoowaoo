import fs from 'node:fs'

type Rule = {
  file: string
  patterns: string[]
}

const RULES: Rule[] = [
  {
    file: 'src/lib/api-errors.ts',
    patterns: ['x-request-id', 'api.request.start', 'api.request.finish', 'api.request.error'],
  },
  {
    file: 'src/lib/workers/shared.ts',
    patterns: ['worker.start', 'worker.completed', 'worker.failed', 'durationMs', 'errorCode'],
  },
  {
    file: 'src/app/api/sse/route.ts',
    patterns: ['sse.connect', 'sse.replay', 'sse.disconnect'],
  },
  {
    file: 'scripts/bull-board.ts',
    patterns: ['bull_board.started', 'bull_board.shutdown'],
  },
  {
    file: 'src/lib/task/submitter.ts',
    patterns: ['requestId', 'task.submit.persisted'],
  },
  {
    file: 'src/lib/task/enqueue.ts',
    patterns: ['task.submit.enqueued'],
  },
  {
    file: 'src/lib/task/types.ts',
    patterns: ['trace', 'requestId'],
  },
]

function checkRules(): string[] {
  const violations: string[] = []
  for (const rule of RULES) {
    if (!fs.existsSync(rule.file)) {
      violations.push(`${rule.file} missing (rule file not found)`)
      continue
    }
    const content = fs.readFileSync(rule.file, 'utf8')
    for (const pattern of rule.patterns) {
      if (!content.includes(pattern)) {
        violations.push(`${rule.file} missing "${pattern}"`)
      }
    }
  }
  return violations
}

function main() {
  const violations = checkRules()

  if (violations.length > 0) {
    process.stderr.write('[check:log-semantic] semantic violations detected:\n')
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`)
    }
    process.exit(1)
  }

  process.stdout.write(`[check:log-semantic] ok rules=${RULES.length}\n`)
}

main()
