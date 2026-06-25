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

function sanitizeFilenamePart(value: string): string {
  return value.slice(0, 50).replace(/[\\/:*?"<>|]/g, '_')
}

type VideoPanel = {
  panelIndex: number | null
  description: string | null
  videoUrl: string | null
}

type VideoStoryboard = {
  id: string
  panels: VideoPanel[]
}

type VideoEpisode = {
  storyboards: VideoStoryboard[]
}

async function loadVideoEpisodes(params: { projectId: string; episodeId: string | null }): Promise<VideoEpisode[]> {
  if (params.episodeId) {
    const episode = await prisma.projectEpisode.findFirst({
      where: { id: params.episodeId, projectId: params.projectId },
      include: {
        storyboards: {
          include: {
            panels: {
              orderBy: { panelIndex: 'asc' },
              select: {
                panelIndex: true,
                description: true,
                videoUrl: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!episode) return []
    return [{
      storyboards: episode.storyboards,
    }]
  }

  const project = await prisma.project.findFirst({
    where: { id: params.projectId },
    include: {
      episodes: {
        include: {
          storyboards: {
            include: {
              panels: {
                orderBy: { panelIndex: 'asc' },
                select: {
                  panelIndex: true,
                  description: true,
                  videoUrl: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  })

  return (project?.episodes || []).map((episode) => ({
    storyboards: episode.storyboards,
  }))
}

export function createVideoOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_project_video_urls: defineOperation({
      id: 'get_project_video_urls',
      summary: 'List downloadable project video URLs (via proxy) for client-side downloads.',
      intent: 'query',
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({
        episodeId: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const episodeId = normalizeString(input.episodeId) || null
        const episodes = await loadVideoEpisodes({ projectId: ctx.projectId, episodeId })

        if (episodes.length === 0) {
          throw new ApiError('NOT_FOUND')
        }

        const storyboards: VideoStoryboard[] = []
        for (const episode of episodes) {
          storyboards.push(...episode.storyboards)
        }

        const candidates: Array<{
          storyboardIndex: number
          panelIndex: number
          videoKey: string
          desc: string
        }> = []

        for (let storyboardIndex = 0; storyboardIndex < storyboards.length; storyboardIndex += 1) {
          const storyboard = storyboards[storyboardIndex]
          for (const panel of storyboard.panels || []) {
            const videoKey = panel.videoUrl

            if (!videoKey) continue

            candidates.push({
              storyboardIndex,
              panelIndex: panel.panelIndex || 0,
              videoKey,
              desc: sanitizeFilenamePart(panel.description || '镜头'),
            })
          }
        }

        candidates.sort((a, b) => {
          if (a.storyboardIndex !== b.storyboardIndex) return a.storyboardIndex - b.storyboardIndex
          return a.panelIndex - b.panelIndex
        })

        const project = await prisma.project.findUnique({
          where: { id: ctx.projectId },
          select: { name: true },
        })
        if (!project) throw new ApiError('NOT_FOUND')

        const videos = candidates.map((video, idx) => {
          const index = idx + 1
          const fileName = `${String(index).padStart(3, '0')}_${video.desc}.mp4`
          const proxyUrl = `/api/projects/${ctx.projectId}/video-proxy?key=${encodeURIComponent(video.videoKey)}`
          return {
            index,
            fileName,
            videoUrl: proxyUrl,
          }
        })

        if (videos.length === 0) {
          throw new ApiError('INVALID_PARAMS')
        }

        return {
          projectName: project.name,
          videos,
        }
      },
    }),

    resolve_video_proxy: defineOperation({
      id: 'resolve_video_proxy',
      summary: 'Resolve a video proxy key into a fetchable signed URL (storage-only, avoids SSRF).',
      intent: 'query',
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({
        key: z.string().min(1),
        expiresSeconds: z.number().int().positive().max(24 * 60 * 60).optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const storageKey = await resolveStorageKeyFromMediaValue(input.key)
        if (!storageKey) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'VIDEO_PROXY_KEY_UNRESOLVABLE',
            message: 'key must be resolvable to a storage key',
          })
        }

        const expires = input.expiresSeconds ?? 3600
        const fetchUrl = toFetchableUrl(getSignedUrl(storageKey, expires))
        return { fetchUrl, storageKey, expiresSeconds: expires }
      },
    }),

    list_download_videos: defineOperation({
      id: 'list_download_videos',
      summary: 'Build a stable download plan for project videos (storage keys + filenames).',
      intent: 'query',
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({
        episodeId: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const episodeId = normalizeString(input.episodeId) || null
        const episodes = await loadVideoEpisodes({ projectId: ctx.projectId, episodeId })

        if (episodes.length === 0) {
          throw new ApiError('NOT_FOUND')
        }

        const storyboards: VideoStoryboard[] = []
        for (const episode of episodes) {
          storyboards.push(...episode.storyboards)
        }

        const candidates: Array<{
          storyboardIndex: number
          panelIndex: number
          videoValue: string
          desc: string
        }> = []

        for (let storyboardIndex = 0; storyboardIndex < storyboards.length; storyboardIndex += 1) {
          const storyboard = storyboards[storyboardIndex]
          for (const panel of storyboard.panels || []) {
            const videoValue = panel.videoUrl
            if (!videoValue) continue
            candidates.push({
              storyboardIndex,
              panelIndex: panel.panelIndex || 0,
              videoValue,
              desc: sanitizeFilenamePart(panel.description || '镜头'),
            })
          }
        }

        candidates.sort((a, b) => {
          if (a.storyboardIndex !== b.storyboardIndex) return a.storyboardIndex - b.storyboardIndex
          return a.panelIndex - b.panelIndex
        })

        const project = await prisma.project.findUnique({
          where: { id: ctx.projectId },
          select: { name: true },
        })
        if (!project) throw new ApiError('NOT_FOUND')

        const files = []
        for (let i = 0; i < candidates.length; i += 1) {
          const candidate = candidates[i]
          const storageKey = await resolveStorageKeyFromMediaValue(candidate.videoValue)
          if (!storageKey) {
            throw new ApiError('EXTERNAL_ERROR', {
              code: 'DOWNLOAD_VIDEO_KEY_UNRESOLVABLE',
              message: 'video value must be resolvable to a storage key',
            })
          }

          const ext = (() => {
            const rawExt = path.extname(storageKey).toLowerCase()
            if (!rawExt) return 'mp4'
            return rawExt.replace('.', '')
          })()

          const index = i + 1
          files.push({
            index,
            fileName: `${String(index).padStart(3, '0')}_${candidate.desc}.${ext}`,
            storageKey,
          })
        }

        if (files.length === 0) {
          throw new ApiError('INVALID_PARAMS')
        }

        return {
          projectName: project.name,
          files,
        }
      },
    }),
  }
}
