import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { S3Client, paginateListObjectsV2 } from '@aws-sdk/client-s3'
import { prisma } from '@/lib/prisma'
import { loadS3StorageConfig, toS3ClientConfig } from '@/lib/storage/s3-config'

type SnapshotTask = {
  name: string
  tableName: string
}

type StorageIndexRow = {
  key: string
  hash: string | null
  sizeBytes: number
  lastModified: string | null
}

const BACKUP_ROOT = path.join(process.cwd(), 'data', 'migration-backups')

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function toJson(value: unknown) {
  return JSON.stringify(
    value,
    (_key, val) => (typeof val === 'bigint' ? String(val) : val),
    2,
  )
}

async function writeJson(filePath: string, data: unknown) {
  await fs.writeFile(filePath, toJson(data), 'utf8')
}

function sha256Text(input: string) {
  return createHash('sha256').update(input).digest('hex')
}

function resolveDatabaseFilePath(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null
  if (databaseUrl.startsWith('file:')) {
    const raw = databaseUrl.slice('file:'.length)
    if (!raw) return null
    return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw)
  }
  return null
}

async function listStorageObjects(): Promise<StorageIndexRow[]> {
  const config = loadS3StorageConfig()
  const client = new S3Client(toS3ClientConfig(config, config.endpoint))
  const out: StorageIndexRow[] = []
  for await (const page of paginateListObjectsV2({ client }, {
    Bucket: config.bucket,
    MaxKeys: 1000,
  })) {
    for (const item of page.Contents || []) {
      if (!item.Key) continue
      out.push({
        key: item.Key,
        hash: item.ETag ? item.ETag.replaceAll('"', '') : null,
        sizeBytes: Number(item.Size || 0),
        lastModified: item.LastModified ? item.LastModified.toISOString() : null,
      })
    }
  }

  return out
}

async function buildStorageIndex(): Promise<{ storageType: string; rows: StorageIndexRow[] }> {
  return {
    storageType: 's3',
    rows: await listStorageObjects(),
  }
}

async function snapshotTables(backupDir: string) {
  const tasks: SnapshotTask[] = [
    { name: 'projects', tableName: 'projects' },
    { name: 'projects', tableName: 'projects' },
    { name: 'project_panels', tableName: 'project_panels' },
    { name: 'global_characters', tableName: 'global_characters' },
    { name: 'global_character_appearances', tableName: 'global_character_appearances' },
    { name: 'global_locations', tableName: 'global_locations' },
    { name: 'global_location_images', tableName: 'global_location_images' },
    { name: 'tasks', tableName: 'tasks' },
    { name: 'task_events', tableName: 'task_events' },
  ]

  const counts: Record<string, number> = {}
  for (const task of tasks) {
    const rows = (await prisma.$queryRawUnsafe(`SELECT * FROM \`${task.tableName}\``)) as unknown[]
    counts[task.name] = rows.length
    await writeJson(path.join(backupDir, `${task.name}.json`), rows)
  }

  return counts
}

async function writeChecksums(backupDir: string) {
  const files = (await fs.readdir(backupDir)).sort()
  const sums: Record<string, string> = {}

  for (const file of files) {
    const filePath = path.join(backupDir, file)
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) continue
    const buf = await fs.readFile(filePath)
    sums[file] = createHash('sha256').update(buf).digest('hex')
  }

  await writeJson(path.join(backupDir, 'checksums.json'), sums)
}

async function backupDbFile(backupDir: string) {
  const dbFile = resolveDatabaseFilePath(process.env.DATABASE_URL)
  if (!dbFile) return null

  const stat = await fs.stat(dbFile).catch(() => null)
  if (!stat || !stat.isFile()) return null

  const fileName = path.basename(dbFile)
  const target = path.join(backupDir, `db-file-${fileName}`)
  await fs.copyFile(dbFile, target)
  return path.basename(target)
}

async function main() {
  const stamp = nowStamp()
  const backupDir = path.join(BACKUP_ROOT, stamp)
  await fs.mkdir(backupDir, { recursive: true })

  const meta: Record<string, unknown> = {
    createdAt: new Date().toISOString(),
    backupDir,
    databaseUrl: process.env.DATABASE_URL || null,
    storageType: 's3',
    nodeEnv: process.env.NODE_ENV || null,
  }

  const copiedDbFile = await backupDbFile(backupDir)
  meta.copiedDbFile = copiedDbFile

  const tableCounts = await snapshotTables(backupDir)
  meta.tableCounts = tableCounts

  const storage = await buildStorageIndex()
  meta.storageType = storage.storageType
  meta.storageObjectCount = storage.rows.length
  await writeJson(path.join(backupDir, 'storage-object-index.json'), storage.rows)

  await writeChecksums(backupDir)
  meta.metadataChecksum = sha256Text(toJson(meta))
  await writeJson(path.join(backupDir, 'metadata.json'), meta)

  _ulogInfo(`[media-safety-backup] done: ${backupDir}`)
  _ulogInfo(`[media-safety-backup] tableCounts=${JSON.stringify(tableCounts)}`)
  _ulogInfo(`[media-safety-backup] storageObjects=${storage.rows.length}`)
}

main()
  .catch((error) => {
    _ulogError('[media-safety-backup] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
