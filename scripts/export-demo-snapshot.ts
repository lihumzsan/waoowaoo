import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { getMediaObjectByPublicId, resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { getObjectBuffer } from '@/lib/storage'
import {
  DEMO_SNAPSHOT_SCHEMA_VERSION,
  findDemoSnapshotPrivateMediaReferences,
  isDemoPublicAssetPath,
  type DemoProjectSnapshot,
} from '@/lib/demo/demo-snapshot'
import { readProjectEditScreenplay, readProjectEditScript } from '@/lib/edit-script/service'
import { normalizeFinalVideoSummary } from '@/lib/operations/domains/gui/final-video-summary'
import type {
  ProjectClip,
  ProjectEditScreenplay,
  ProjectEditScript,
  ProjectFinalVideo,
  ProjectShot,
  ProjectStoryboard,
  ProjectVideoGroup,
} from '@/types/project'

const DEFAULT_PROJECT_ID = '79242138-9e41-4857-8577-4414d8adf677'
const DEFAULT_EPISODE_ID = '40e8617c-9c15-4208-9e85-00f08af03121'
const DEFAULT_SLUG = 'matrix-demo'
const JSON_STRING_MEDIA_FIELDS = new Set([
  'candidateImages',
  'imageHistory',
  'lastVideoGenerationOptions',
])
const MEDIA_FILE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a)(?:[?#].*)?$/i

interface ExportOptions {
  readonly projectId: string
  readonly episodeId: string
  readonly slug: string
}

interface CopiedAsset {
  readonly sourceKey: string
  readonly publicPath: string
  readonly bytes: number
}

interface MediaLikeRecord extends Record<string, unknown> {
  readonly publicId?: unknown
  readonly url?: unknown
  readonly storageKey?: unknown
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`
  const value = process.argv.find((arg) => arg.startsWith(prefix))
  return value ? value.slice(prefix.length).trim() : null
}

function readOptions(): ExportOptions {
  return {
    projectId: readArg('project') ?? DEFAULT_PROJECT_ID,
    episodeId: readArg('episode') ?? DEFAULT_EPISODE_ID,
    slug: readArg('slug') ?? DEFAULT_SLUG,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function hasPublicMediaUrl(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeSnapshotStatusesForReadOnlyDemo(snapshot: DemoProjectSnapshot): DemoProjectSnapshot {
  return {
    ...snapshot,
    storyboards: snapshot.storyboards.map((storyboard) => ({
      ...storyboard,
      panels: storyboard.panels?.map((panel) => ({
        ...panel,
        imageTaskRunning: false,
        videoTaskRunning: false,
        imageErrorMessage: hasPublicMediaUrl(panel.imageUrl) || hasPublicMediaUrl(panel.media?.url)
          ? null
          : panel.imageErrorMessage,
        videoErrorCode: hasPublicMediaUrl(panel.videoUrl) || hasPublicMediaUrl(panel.videoMedia?.url)
          ? null
          : panel.videoErrorCode,
        videoErrorMessage: hasPublicMediaUrl(panel.videoUrl) || hasPublicMediaUrl(panel.videoMedia?.url)
          ? null
          : panel.videoErrorMessage,
      })),
    })),
    shots: snapshot.shots.map((shot) => ({
      ...shot,
      imageTaskRunning: false,
    })),
    videoGroups: snapshot.videoGroups.map((group) => ({
      ...group,
      status: hasPublicMediaUrl(group.videoUrl) || hasPublicMediaUrl(group.videoMedia?.url)
        ? 'completed'
        : group.status,
      taskId: hasPublicMediaUrl(group.videoUrl) || hasPublicMediaUrl(group.videoMedia?.url)
        ? null
        : group.taskId,
      errorCode: hasPublicMediaUrl(group.videoUrl) || hasPublicMediaUrl(group.videoMedia?.url)
        ? null
        : group.errorCode,
      errorMessage: hasPublicMediaUrl(group.videoUrl) || hasPublicMediaUrl(group.videoMedia?.url)
        ? null
        : group.errorMessage,
    })),
    finalVideo: snapshot.finalVideo ? {
      ...snapshot.finalVideo,
      renderStatus: hasPublicMediaUrl(snapshot.finalVideo.outputUrl)
        ? 'completed'
        : snapshot.finalVideo.renderStatus,
      bgmScore: snapshot.finalVideo.bgmScore ? {
        ...snapshot.finalVideo.bgmScore,
        status: hasPublicMediaUrl(snapshot.finalVideo.bgmScore.mix?.url)
          ? 'completed'
          : snapshot.finalVideo.bgmScore.status,
      } : snapshot.finalVideo.bgmScore,
    } : snapshot.finalVideo,
  }
}

function isMediaLikeRecord(value: Record<string, unknown>): value is MediaLikeRecord {
  return typeof value.url === 'string'
    && typeof value.publicId === 'string'
    && (
      Object.prototype.hasOwnProperty.call(value, 'mimeType')
      || Object.prototype.hasOwnProperty.call(value, 'sizeBytes')
      || Object.prototype.hasOwnProperty.call(value, 'durationMs')
    )
}

function shouldTryMediaString(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || isDemoPublicAssetPath(trimmed) || trimmed.startsWith('PENDING:')) return false
  if (trimmed.startsWith('/m/')) return true
  if (trimmed.startsWith('/api/files/') || trimmed.startsWith('/api/storage/sign')) return true
  if (/^(images|image|videos|video|audio|voice|voices|music|uploads|tmp)\//i.test(trimmed)) {
    return MEDIA_FILE_EXTENSION_PATTERN.test(trimmed)
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return MEDIA_FILE_EXTENSION_PATTERN.test(trimmed)
  }
  return false
}

function extensionFromStorageKey(storageKey: string): string {
  const ext = path.extname(storageKey.split('?')[0] ?? '').toLowerCase()
  return ext || '.bin'
}

async function resolveStorageKeyFromMediaRecord(record: MediaLikeRecord): Promise<string | null> {
  if (typeof record.storageKey === 'string' && record.storageKey.trim()) {
    return record.storageKey.trim()
  }

  if (typeof record.publicId === 'string' && record.publicId.trim()) {
    const media = await getMediaObjectByPublicId(record.publicId.trim())
    if (media?.storageKey) return media.storageKey
  }

  return typeof record.url === 'string'
    ? await resolveStorageKeyFromMediaValue(record.url)
    : null
}

async function buildMediaRewriter(slug: string) {
  const outputDir = path.join(process.cwd(), 'public', 'demo-assets', slug)
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  const keyToPublicPath = new Map<string, Promise<CopiedAsset>>()

  async function copyStorageKey(storageKey: string): Promise<CopiedAsset> {
    const normalizedKey = storageKey.replace(/^\/+/, '')
    const existing = keyToPublicPath.get(normalizedKey)
    if (existing) return await existing

    const promise = (async () => {
      let buffer: Buffer
      try {
        buffer = await getObjectBuffer(normalizedKey)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to copy demo asset "${normalizedKey}": ${message}`)
      }
      const hash = crypto.createHash('sha1').update(normalizedKey).digest('hex').slice(0, 16)
      const filename = `${hash}${extensionFromStorageKey(normalizedKey)}`
      const outputPath = path.join(outputDir, filename)
      await fs.writeFile(outputPath, buffer)
      return {
        sourceKey: normalizedKey,
        publicPath: `/demo-assets/${slug}/${filename}`,
        bytes: buffer.byteLength,
      }
    })()

    keyToPublicPath.set(normalizedKey, promise)
    return await promise
  }

  async function rewriteString(value: string): Promise<string> {
    if (!shouldTryMediaString(value)) return value
    const storageKey = await resolveStorageKeyFromMediaValue(value)
    if (!storageKey) return value
    const asset = await copyStorageKey(storageKey)
    return asset.publicPath
  }

  async function rewriteJsonString(value: string): Promise<string> {
    try {
      const parsed = JSON.parse(value) as unknown
      const rewritten = await rewriteValue(parsed, null)
      return JSON.stringify(rewritten)
    } catch {
      return await rewriteString(value)
    }
  }

  async function rewriteRecord(record: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (isMediaLikeRecord(record)) {
      const storageKey = await resolveStorageKeyFromMediaRecord(record)
      if (!storageKey) return record
      const asset = await copyStorageKey(storageKey)
      const rewrittenMedia: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(record)) {
        if (key === 'storageKey') continue
        rewrittenMedia[key] = key === 'url' ? asset.publicPath : value
      }
      return rewrittenMedia
    }

    const rewrittenRecord: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key === 'storageKey') continue
      const rewritten = await rewriteValue(value, key)
      if (rewritten !== undefined) {
        rewrittenRecord[key] = rewritten
      }
    }
    return rewrittenRecord
  }

  async function rewriteValue(value: unknown, key: string | null): Promise<unknown> {
    if (typeof value === 'string') {
      return key && JSON_STRING_MEDIA_FIELDS.has(key)
        ? await rewriteJsonString(value)
        : await rewriteString(value)
    }

    if (Array.isArray(value)) {
      return await Promise.all(value.map((item) => rewriteValue(item, null)))
    }

    if (isRecord(value)) {
      return await rewriteRecord(value)
    }

    return value
  }

  return {
    rewriteSnapshot: async (snapshot: DemoProjectSnapshot): Promise<DemoProjectSnapshot> => {
      const rewritten = await rewriteValue(snapshot, null)
      return rewritten as DemoProjectSnapshot
    },
    copiedAssets: async (): Promise<CopiedAsset[]> => {
      return await Promise.all([...keyToPublicPath.values()])
    },
  }
}

async function buildSnapshot(options: ExportOptions): Promise<DemoProjectSnapshot> {
  const project = await prisma.project.findUnique({
    where: { id: options.projectId },
    select: {
      id: true,
      name: true,
      videoRatio: true,
      videoModel: true,
      singleShotVideoModel: true,
      sequenceVideoModel: true,
    },
  })
  if (!project) throw new Error(`Project not found: ${options.projectId}`)

  const episode = await prisma.projectEpisode.findFirst({
    where: {
      id: options.episodeId,
      projectId: options.projectId,
    },
    include: {
      clips: { orderBy: [{ start: 'asc' }, { createdAt: 'asc' }] },
      shots: { orderBy: [{ srtStart: 'asc' }, { createdAt: 'asc' }] },
      storyboards: {
        orderBy: { createdAt: 'asc' },
        include: {
          panels: { orderBy: { panelIndex: 'asc' } },
          blockingArtifacts: { orderBy: [{ kind: 'asc' }, { groupIndex: 'asc' }, { createdAt: 'asc' }] },
        },
      },
      videoGroups: { orderBy: { createdAt: 'asc' } },
      editorProject: true,
    },
  })
  if (!episode) throw new Error(`Episode not found: ${options.episodeId}`)

  const mediaEpisode = await attachMediaFieldsToProject(cloneJson(episode) as Record<string, unknown>)
  const serializedEpisode = cloneJson(mediaEpisode)
  const editScreenplay = await readProjectEditScreenplay({
    projectId: options.projectId,
    episodeId: options.episodeId,
  })
  const editScript = await readProjectEditScript({
    projectId: options.projectId,
    episodeId: options.episodeId,
  })
  const finalVideo = normalizeFinalVideoSummary(serializedEpisode.editorProject) as ProjectFinalVideo | null

  return {
    schemaVersion: DEMO_SNAPSHOT_SCHEMA_VERSION,
    slug: options.slug,
    project: {
      id: project.id,
      name: project.name,
      videoRatio: project.videoRatio,
      videoModel: project.videoModel,
      singleShotVideoModel: project.singleShotVideoModel,
      sequenceVideoModel: project.sequenceVideoModel,
    },
    episode: {
      id: episode.id,
      episodeNumber: episode.episodeNumber,
      name: episode.name,
      description: episode.description,
      novelText: episode.novelText,
      audioUrl: serializedEpisode.audioUrl as string | null,
      srtContent: episode.srtContent,
    },
    clips: readArray<ProjectClip>(serializedEpisode.clips),
    storyboards: readArray<ProjectStoryboard>(serializedEpisode.storyboards),
    shots: readArray<ProjectShot>(serializedEpisode.shots),
    editScreenplay: editScreenplay as ProjectEditScreenplay | null,
    editScript: editScript as ProjectEditScript | null,
    finalVideo,
    videoGroups: readArray<ProjectVideoGroup>(serializedEpisode.videoGroups),
    layout: null,
    exportedAt: new Date().toISOString(),
  }
}

async function main() {
  const options = readOptions()
  const snapshot = normalizeSnapshotStatusesForReadOnlyDemo(await buildSnapshot(options))
  const rewriter = await buildMediaRewriter(options.slug)
  const publicSnapshot = await rewriter.rewriteSnapshot(snapshot)
  const privateRefs = findDemoSnapshotPrivateMediaReferences(publicSnapshot)
  if (privateRefs.length > 0) {
    throw new Error(`Demo snapshot still contains private media references:\n${privateRefs.join('\n')}`)
  }

  const dataDir = path.join(process.cwd(), 'src', 'demo-data')
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(
    path.join(dataDir, `${options.slug}.json`),
    `${JSON.stringify(publicSnapshot, null, 2)}\n`,
  )

  const assets = await rewriter.copiedAssets()
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0)
  console.info(`Exported ${options.slug}: ${assets.length} assets, ${totalBytes} bytes`)
  console.info(`/zh/demo/${options.slug}`)
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode ?? 0)
  })
