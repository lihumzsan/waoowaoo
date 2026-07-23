import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { deleteObjects, extractStorageKey } from '@/lib/storage'
import {
  assertMountainResetCanExecute,
  buildMountainResetPlan,
  createMountainResetSnapshot,
  executeMountainReset,
  parseMountainResetArgs,
} from '@/lib/novel-promotion/mountain-reset'

const DEFAULT_PROJECT_ID = '8cc23f52-531c-45f5-8ada-8eaac1666b25'

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

async function writeSnapshot(snapshot: Record<string, unknown>): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(process.cwd(), '.tmp', 'mountain-reset', timestamp)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, 'source-snapshot.json')
  await fs.writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return filePath
}

async function main(): Promise<void> {
  const args = parseMountainResetArgs({ defaultProjectId: DEFAULT_PROJECT_ID })
  const plan = await buildMountainResetPlan(prisma, args, extractStorageKey)
  const snapshotPath = await writeSnapshot(createMountainResetSnapshot(plan))
  assertMountainResetCanExecute(args, plan)

  if (args.dryRun) {
    write({
      mode: 'dry-run',
      snapshotPath,
      counts: plan.counts,
      activeTasks: plan.activeTasks,
      preservedEpisodes: plan.preserved.episodes.map((episode) => ({
        id: episode.id,
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        novelTextLength: episode.novelTextLength,
      })),
    })
    return
  }

  const result = await executeMountainReset(prisma, plan)
  let storageDeletion = {
    attempted: result.plan.deleteStorage ? result.plan.storageKeys.length : 0,
    success: 0,
    failed: 0,
    skipped: !result.plan.deleteStorage,
    error: undefined as string | undefined,
  }

  if (result.plan.deleteStorage && result.plan.storageKeys.length > 0) {
    try {
      const deleted = await deleteObjects(result.plan.storageKeys)
      storageDeletion = {
        attempted: result.plan.storageKeys.length,
        success: deleted.success,
        failed: deleted.failed,
        skipped: false,
        error: undefined,
      }
    } catch (error) {
      storageDeletion = {
        attempted: result.plan.storageKeys.length,
        success: 0,
        failed: result.plan.storageKeys.length,
        skipped: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  write({
    mode: 'reset',
    snapshotPath,
    countsBeforeReset: plan.counts,
    deletedCounts: result.deletedCounts,
    mediaObjects: result.mediaObjects,
    coverMediaObjects: result.coverMediaObjects,
    storageDeletion,
    preservedEpisodes: plan.preserved.episodes.map((episode) => ({
      id: episode.id,
      episodeNumber: episode.episodeNumber,
      name: episode.name,
      novelTextLength: episode.novelTextLength,
    })),
  })
}

main()
  .catch((error) => {
    write({
      error: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
