import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { S3Client, paginateListObjectsV2 } from '@aws-sdk/client-s3'
import { prisma } from '@/lib/prisma'

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

async function listLocalFilesRecursively(rootDir: string, prefix = ''): Promise<StorageIndexRow[]> {
  const fullDir = path.join(rootDir, prefix)
  const entries = await fs.readdir(fullDir, { withFileTypes: true })
  const out: StorageIndexRow[] = []

  for (const entry of entries) {
    const rel = path.join(prefix, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await listLocalFilesRecursively(rootDir, rel)))
      continue
    }
    if (!entry.isFile()) continue

    const filePath = path.join(rootDir, rel)
    const stat = await fs.stat(filePath)
    const buf = await fs.readFile(filePath)
    out.push({
      key: rel.split(path.sep).join('/'),
      hash: createHash('sha256').update(buf).digest('hex'),
      sizeBytes: stat.size,
      lastModified: stat.mtime.toISOString(),
    })
  }

  return out
}

async function listCosObjects(): Promise<StorageIndexRow[]> {
  const secretId = process.env.COS_SECRET_ID
  const secretKey = process.env.COS_SECRET_KEY
  const bucket = process.env.COS_BUCKET
  const region = process.env.COS_REGION

  if (!secretId || !secretKey || !bucket || !region) {
    throw new Error('Missing COS env: COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION')
  }

  // COS speaks the S3 wire protocol; the shared S3 SDK replaces the COS-only one.
  const client = new S3Client({
    endpoint: `https://cos.${region}.myqcloud.com`,
    region,
    credentials: { accessKeyId: secretId, secretAccessKey: secretKey },
  })
  const out: StorageIndexRow[] = []
  for await (const page of paginateListObjectsV2({ client }, { Bucket: bucket, MaxKeys: 1000 })) {
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
  const storageType = process.env.STORAGE_TYPE || 'cos'
  if (storageType === 'local') {
    const uploadDir = process.env.UPLOAD_DIR || './data/uploads'
    const rootDir = path.isAbsolute(uploadDir) ? uploadDir : path.join(process.cwd(), uploadDir)
    const exists = await fs.stat(rootDir).then(() => true).catch(() => false)
    if (!exists) {
      return { storageType, rows: [] }
    }
    const rows = await listLocalFilesRecursively(rootDir)
    return { storageType, rows }
  }

  const rows = await listCosObjects()
  return { storageType, rows }
}

async function snapshotTables(backupDir: string) {
  const tasks: SnapshotTask[] = [
    { name: 'projects', tableName: 'projects' },
    { name: 'projects', tableName: 'projects' },
    { name: 'project_episodes', tableName: 'project_episodes' },
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
    storageType: process.env.STORAGE_TYPE || 'cos',
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
