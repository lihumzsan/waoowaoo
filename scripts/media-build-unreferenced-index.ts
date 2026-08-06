import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { S3Client, paginateListObjectsV2 } from '@aws-sdk/client-s3'
import { prisma } from '@/lib/prisma'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { loadS3StorageConfig, toS3ClientConfig } from '@/lib/storage/s3-config'
import { MEDIA_MODEL_MAPPINGS } from './media-mapping'

type StorageEntry = {
  key: string
  sizeBytes: number
  lastModified: string | null
}
type DynamicModel = {
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>
}
const prismaDynamic = prisma as unknown as Record<string, DynamicModel>

const BACKUP_ROOT = path.join(process.cwd(), 'data', 'migration-backups')

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function listStorageObjects(): Promise<{ storageType: 's3'; rows: StorageEntry[] }> {
  const config = loadS3StorageConfig()
  const client = new S3Client(toS3ClientConfig(config, config.endpoint))
  const rows: StorageEntry[] = []
  for await (const page of paginateListObjectsV2({ client }, {
    Bucket: config.bucket,
    MaxKeys: 1000,
  })) {
    for (const item of page.Contents || []) {
      if (!item.Key) continue
      rows.push({
        key: item.Key,
        sizeBytes: Number(item.Size || 0),
        lastModified: item.LastModified ? item.LastModified.toISOString() : null,
      })
    }
  }

  return { storageType: 's3', rows }
}

async function buildReferencedKeySet() {
  const refs = new Set<string>()

  try {
    const mediaRows = await prismaDynamic.mediaObject.findMany({
      select: { storageKey: true },
    })
    for (const row of mediaRows) {
      if (typeof row.storageKey === 'string' && row.storageKey.trim()) refs.add(row.storageKey)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    _ulogError('[media-build-unreferenced-index] media_objects unavailable, fallback to legacy field scan', message)
  }

  for (const mapping of MEDIA_MODEL_MAPPINGS) {
    const model = prismaDynamic[mapping.model]
    if (!model) continue

    const select: Record<string, true> = { id: true }
    for (const field of mapping.fields) select[field.legacyField] = true

    let cursor: string | null = null
    while (true) {
      const rows = await model.findMany({
        select,
        ...(cursor
          ? {
            cursor: { id: cursor },
            skip: 1,
          }
          : {}),
        orderBy: { id: 'asc' },
        take: 500,
      })
      if (!rows.length) break

      for (const row of rows) {
        for (const field of mapping.fields) {
          const value = row[field.legacyField]
          if (typeof value !== 'string' || !value.trim()) continue
          const key = await resolveStorageKeyFromMediaValue(value)
          if (key) refs.add(key)
        }
      }

      cursor = String(rows[rows.length - 1].id)
    }
  }

  return refs
}

async function main() {
  const stamp = nowStamp()
  const backupDir = path.join(BACKUP_ROOT, stamp)
  await fs.mkdir(backupDir, { recursive: true })

  const referenced = await buildReferencedKeySet()
  const storage = await listStorageObjects()
  const unreferenced = storage.rows.filter((row) => !referenced.has(row.key))

  const output = {
    createdAt: new Date().toISOString(),
    storageType: storage.storageType,
    totalStorageObjects: storage.rows.length,
    referencedKeyCount: referenced.size,
    unreferencedCount: unreferenced.length,
    objects: unreferenced,
  }

  const filePath = path.join(backupDir, 'unreferenced-storage-objects-index.json')
  await fs.writeFile(filePath, JSON.stringify(output, null, 2), 'utf8')

  _ulogInfo(`[media-build-unreferenced-index] storageType=${storage.storageType}`)
  _ulogInfo(`[media-build-unreferenced-index] total=${storage.rows.length} unreferenced=${unreferenced.length}`)
  _ulogInfo(`[media-build-unreferenced-index] output=${filePath}`)
}

main()
  .catch((error) => {
    _ulogError('[media-build-unreferenced-index] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
