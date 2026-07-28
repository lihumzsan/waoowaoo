import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  CreativeResourceLinkView,
  CreativeResourceMaterializedRef,
  CreativeResourceMediaType,
} from './contracts'
import { isCreativeResourceMediaType } from './contracts'

type CreativeResourceLinkReadClient = Pick<
  Prisma.TransactionClient,
  'creativeResourceRevision'
> | typeof prisma

const FILE_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/x-wav': 'wav',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
} as const

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  errorCode: string,
): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(errorCode)
  return value.trim()
}

export function readCreativeResourceMaterializedRefs(
  result: unknown,
): CreativeResourceMaterializedRef[] {
  const record = readRecord(result)
  if (!record || !Array.isArray(record.resources)) {
    throw new Error('CREATIVE_RESOURCE_ASSISTANT_RESULT_RESOURCES_MISSING')
  }
  const refs = record.resources.map((value, index) => {
    const resource = readRecord(value)
    if (!resource) {
      throw new Error(`CREATIVE_RESOURCE_ASSISTANT_RESULT_RESOURCE_INVALID:${String(index)}`)
    }
    return {
      resourceId: readRequiredString(
        resource,
        'resourceId',
        `CREATIVE_RESOURCE_ASSISTANT_RESULT_RESOURCE_ID_MISSING:${String(index)}`,
      ),
      revisionId: readRequiredString(
        resource,
        'revisionId',
        `CREATIVE_RESOURCE_ASSISTANT_RESULT_REVISION_ID_MISSING:${String(index)}`,
      ),
    }
  })
  if (refs.length === 0) throw new Error('CREATIVE_RESOURCE_ASSISTANT_RESULT_RESOURCES_EMPTY')
  return refs
}

function requireMediaType(value: string): CreativeResourceMediaType {
  if (!isCreativeResourceMediaType(value)) {
    throw new Error(`CREATIVE_RESOURCE_ASSISTANT_MEDIA_TYPE_INVALID:${value}`)
  }
  return value
}

export function projectCreativeResourceFileName(input: {
  readonly resourceName: string
  readonly mimeType: string | null
}): string {
  const resourceName = input.resourceName.trim()
  if (!resourceName) throw new Error('CREATIVE_RESOURCE_ASSISTANT_NAME_MISSING')
  const extension = input.mimeType
    ? FILE_EXTENSION_BY_MIME_TYPE[input.mimeType.toLowerCase()] ?? null
    : null
  if (!extension || resourceName.toLowerCase().endsWith(`.${extension}`)) return resourceName
  return `${resourceName}.${extension}`
}

export async function readProjectCreativeResourceLinkViews(input: {
  readonly projectId: string
  readonly userId: string
  readonly refs: readonly CreativeResourceMaterializedRef[]
  readonly client?: CreativeResourceLinkReadClient
}): Promise<CreativeResourceLinkView[]> {
  const orderedRefs = input.refs.filter((ref, index, refs) => (
    refs.findIndex((candidate) => (
      candidate.resourceId === ref.resourceId
      && candidate.revisionId === ref.revisionId
    )) === index
  ))
  if (orderedRefs.length === 0) return []
  const client = input.client ?? prisma
  const rows = await client.creativeResourceRevision.findMany({
    where: {
      id: { in: orderedRefs.map((ref) => ref.revisionId) },
      resource: {
        userId: input.userId,
        status: 'ready',
        OR: [
          { projectId: input.projectId },
          { scopeKind: 'user', scopeId: input.userId, projectId: null, episodeId: null },
        ],
      },
    },
    select: {
      id: true,
      resourceId: true,
      media: {
        select: {
          publicId: true,
          mimeType: true,
        },
      },
      resource: {
        select: {
          name: true,
          mediaType: true,
          schemaId: true,
        },
      },
    },
  })
  const rowByRevisionId = new Map(rows.map((row) => [row.id, row]))
  return orderedRefs.map((ref) => {
    const row = rowByRevisionId.get(ref.revisionId)
    if (!row || row.resourceId !== ref.resourceId) {
      throw new Error(
        `CREATIVE_RESOURCE_ASSISTANT_REVISION_NOT_FOUND:${ref.resourceId}:${ref.revisionId}`,
      )
    }
    const mediaType = requireMediaType(row.resource.mediaType)
    if (mediaType !== 'text' && !row.media) {
      throw new Error(`CREATIVE_RESOURCE_ASSISTANT_MEDIA_MISSING:${ref.revisionId}`)
    }
    const mimeType = row.media?.mimeType ?? null
    return {
      resourceId: ref.resourceId,
      revisionId: ref.revisionId,
      mediaType,
      schemaId: row.resource.schemaId,
      resourceName: row.resource.name,
      fileName: projectCreativeResourceFileName({
        resourceName: row.resource.name,
        mimeType,
      }),
      href: row.media
        ? `/m/${encodeURIComponent(row.media.publicId)}`
        : null,
      mimeType,
    }
  })
}
