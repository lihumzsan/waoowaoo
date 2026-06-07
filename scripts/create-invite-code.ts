import { createInviteCode } from '@/lib/billing/invite-codes'
import { prisma } from '@/lib/prisma'

type CliArgs = {
  code?: string
  amount?: number
  maxRedemptions?: number
  expiresAt?: Date
  description?: string
  createdBy?: string
}

function readArgValue(args: string[], name: string): string | null {
  const prefix = `--${name}=`
  const matched = args.find((arg) => arg.startsWith(prefix))
  if (!matched) return null
  const value = matched.slice(prefix.length).trim()
  return value || null
}

function parseArgs(args: string[]): CliArgs {
  const amountRaw = readArgValue(args, 'amount')
  const maxRedemptionsRaw = readArgValue(args, 'max-redemptions')
  const expiresAtRaw = readArgValue(args, 'expires-at')
  const amount = amountRaw ? Number(amountRaw) : undefined
  const maxRedemptions = maxRedemptionsRaw ? Number.parseInt(maxRedemptionsRaw, 10) : undefined
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : undefined

  return {
    code: readArgValue(args, 'code') ?? undefined,
    amount,
    maxRedemptions: Number.isFinite(maxRedemptions) ? maxRedemptions : undefined,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : undefined,
    description: readArgValue(args, 'description') ?? undefined,
    createdBy: readArgValue(args, 'created-by') ?? undefined,
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.code || !parsed.amount) {
    throw new Error('Usage: tsx scripts/create-invite-code.ts --code=CODE --amount=100 [--max-redemptions=10] [--expires-at=2026-12-31] [--description=...] [--created-by=...]')
  }

  const result = await createInviteCode({
    code: parsed.code,
    amount: parsed.amount,
    maxRedemptions: parsed.maxRedemptions,
    expiresAt: parsed.expiresAt,
    description: parsed.description,
    createdBy: parsed.createdBy,
  })

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
