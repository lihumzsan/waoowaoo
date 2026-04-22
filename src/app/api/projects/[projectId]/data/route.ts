import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { resolveEpisodeStageArtifacts } from '@/lib/novel-promotion/stage-readiness'

function readAssetKind(value: Record<string, unknown>): string {
  return typeof value.assetKind === 'string' ? value.assetKind : 'location'
}

function buildEpisodeSummaryInclude() {
  return {
    orderBy: { episodeNumber: 'asc' as const },
    include: {
      clips: {
        where: {
          screenplay: {
            not: null,
          },
          NOT: {
            screenplay: '',
          },
        },
        select: { id: true },
        take: 1,
      },
      storyboards: {
        where: {
          panels: {
            some: {},
          },
        },
        select: {
          id: true,
          panels: {
            where: {
              videoUrl: {
                not: null,
              },
              NOT: {
                videoUrl: '',
              },
            },
            select: { id: true },
            take: 1,
          },
        },
        take: 1,
      },
      voiceLines: {
        select: { id: true },
        take: 1,
      },
    },
  }
}

/**
 * Unified project bootstrap payload for the workspace.
 * Keep the default response lightweight so opening a project does not
 * eagerly hydrate the full asset library. Asset-heavy callers can opt in
 * with `?includeAssets=1`.
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const includeAssets = new URL(request.url).searchParams.get('includeAssets') === '1'

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { user: true }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  prisma.project.update({
    where: { id: projectId },
    data: { lastAccessedAt: new Date() }
  }).catch(err => _ulogError('Failed to update lastAccessedAt', err))

  const novelPromotionData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: includeAssets
      ? {
        episodes: buildEpisodeSummaryInclude(),
        characters: {
          include: {
            appearances: true
          },
          orderBy: { createdAt: 'asc' }
        },
        locations: {
          include: {
            images: true
          },
          orderBy: { createdAt: 'asc' }
        }
      }
      : {
        episodes: buildEpisodeSummaryInclude()
      }
  })

  if (!novelPromotionData) {
    throw new ApiError('NOT_FOUND')
  }

  const novelPromotionDataWithSignedUrls = await attachMediaFieldsToProject(novelPromotionData)
  const episodesWithArtifactReadiness = (novelPromotionDataWithSignedUrls.episodes || []).map((episode) => ({
    ...episode,
    artifactReadiness: resolveEpisodeStageArtifacts(episode),
  }))

  const serializedNovelPromotionData = includeAssets
    ? {
      ...novelPromotionDataWithSignedUrls,
      episodes: episodesWithArtifactReadiness,
      locations: (novelPromotionDataWithSignedUrls.locations || []).filter((item) => readAssetKind(item) !== 'prop'),
      props: (novelPromotionDataWithSignedUrls.locations || []).filter((item) => readAssetKind(item) === 'prop'),
    }
    : {
      ...novelPromotionDataWithSignedUrls,
      episodes: episodesWithArtifactReadiness,
    }

  const fullProject = {
    ...project,
    novelPromotionData: serializedNovelPromotionData
  }

  return NextResponse.json({ project: fullProject })
})
