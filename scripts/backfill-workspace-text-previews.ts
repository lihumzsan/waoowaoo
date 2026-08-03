import { prisma } from '@/lib/prisma'
import {
  readWorkspaceResourceTextContent,
  workspaceResourceContentPreview,
} from '@/lib/workspace-resource/content-store'

/**
 * One-time backfill for WorkspaceResourceVersion.contentPreview: versions
 * written before the preview column existed read their canonical content from
 * object storage once and persist the bounded preview. New writes always set
 * the column, so reruns are cheap no-ops.
 */
async function main() {
  const versions = await prisma.workspaceResourceVersion.findMany({
    where: { contentKind: { in: ['text', 'structured'] }, contentPreview: null },
    select: { id: true, media: { select: { storageKey: true } } },
  })
  let updated = 0
  let failed = 0
  for (const version of versions) {
    if (!version.media.storageKey) {
      failed += 1
      console.error(`[backfill] version ${version.id} has no storage key`)
      continue
    }
    try {
      const content = await readWorkspaceResourceTextContent(version.media.storageKey)
      await prisma.workspaceResourceVersion.update({
        where: { id: version.id },
        data: { contentPreview: workspaceResourceContentPreview(content) },
      })
      updated += 1
    } catch (error) {
      failed += 1
      console.error(`[backfill] failed for version ${version.id}`, error)
    }
  }
  console.log(`[backfill] candidates=${versions.length} updated=${updated} failed=${failed}`)
  await prisma.$disconnect()
  if (failed > 0) process.exitCode = 1
}

void main()
