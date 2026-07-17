import path from 'node:path'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { getSignedUrl, toFetchableUrl } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const QUERY_EFFECTS = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

async function loadVideoSegments(params: { projectId: string; episodeId: string | null }) {
  return prisma.projectVideoSegment.findMany({
    where: {
      projectId: params.projectId,
      ...(params.episodeId ? { episodeId: params.episodeId } : {}),
      videoMediaId: { not: null },
    },
    orderBy: [
      { chapter: { chapterIndex: 'asc' } },
      { createdAt: 'asc' },
    ],
    select: {
      id: true,
      segmentId: true,
      videoMedia: {
        select: {
          storageKey: true,
        },
      },
    },
  })
}

export function createVideoOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_project_video_urls: defineOperation({
      id: 'get_project_video_urls',
      summary: 'List downloadable generated video-segment URLs through the storage proxy.',
      intent: 'query',
      effects: QUERY_EFFECTS,
      inputSchema: z.object({
        episodeId: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const segments = await loadVideoSegments({
          projectId: ctx.projectId,
          episodeId: normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId) || null,
        })
        if (segments.length === 0) throw new ApiError('NOT_FOUND')

        const project = await prisma.project.findUnique({
          where: { id: ctx.projectId },
          select: { name: true },
        })
        if (!project) throw new ApiError('NOT_FOUND')

        return {
          projectName: project.name,
          videos: segments.map((segment, index) => {
            const storageKey = segment.videoMedia?.storageKey
            if (!storageKey) throw new Error(`VIDEO_SEGMENT_MEDIA_STORAGE_KEY_REQUIRED:${segment.id}`)
            return {
              index: index + 1,
              fileName: `${String(index + 1).padStart(3, '0')}_${segment.segmentId}.mp4`,
              videoUrl: `/api/projects/${ctx.projectId}/video-proxy?key=${encodeURIComponent(storageKey)}`,
            }
          }),
        }
      },
    }),

    resolve_video_proxy: defineOperation({
      id: 'resolve_video_proxy',
      summary: 'Resolve a video proxy key into a fetchable signed URL at the storage boundary.',
      intent: 'query',
      effects: QUERY_EFFECTS,
      inputSchema: z.object({
        key: z.string().min(1),
        expiresSeconds: z.number().int().positive().max(24 * 60 * 60).optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (_ctx, input) => {
        const storageKey = await resolveStorageKeyFromMediaValue(input.key)
        if (!storageKey) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'VIDEO_PROXY_KEY_UNRESOLVABLE',
            message: 'key must be resolvable to a storage key',
          })
        }
        const expiresSeconds = input.expiresSeconds ?? 3600
        return {
          fetchUrl: toFetchableUrl(getSignedUrl(storageKey, expiresSeconds)),
          storageKey,
          expiresSeconds,
        }
      },
    }),

    list_download_videos: defineOperation({
      id: 'list_download_videos',
      summary: 'Build a stable download plan for generated video segments.',
      intent: 'query',
      effects: QUERY_EFFECTS,
      inputSchema: z.object({
        episodeId: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const segments = await loadVideoSegments({
          projectId: ctx.projectId,
          episodeId: normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId) || null,
        })
        if (segments.length === 0) throw new ApiError('NOT_FOUND')

        const project = await prisma.project.findUnique({
          where: { id: ctx.projectId },
          select: { name: true },
        })
        if (!project) throw new ApiError('NOT_FOUND')

        return {
          projectName: project.name,
          files: segments.map((segment, index) => {
            const storageKey = segment.videoMedia?.storageKey
            if (!storageKey) throw new Error(`VIDEO_SEGMENT_MEDIA_STORAGE_KEY_REQUIRED:${segment.id}`)
            const extension = path.extname(storageKey).toLowerCase().replace('.', '') || 'mp4'
            return {
              index: index + 1,
              fileName: `${String(index + 1).padStart(3, '0')}_${segment.segmentId}.${extension}`,
              storageKey,
            }
          }),
        }
      },
    }),
  }
}
