import { performance } from 'node:perf_hooks'
import { prisma } from '@/lib/prisma'

type Stage = 'config' | 'script' | 'assets' | 'storyboard' | 'videos' | 'voice'

type TimedResult<T> = {
  name: string
  elapsedMs: number
  result: T
}

const DEFAULT_PROJECT_ID = '8cc23f52-531c-45f5-8ada-8eaac1666b25'

function readArg(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find((item) => item.startsWith(prefix))
  return arg ? arg.slice(prefix.length).trim() : null
}

function safeStage(value: string | null): Stage {
  if (value === 'config' || value === 'script' || value === 'assets' || value === 'storyboard' || value === 'videos' || value === 'voice') {
    return value
  }
  return 'storyboard'
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null))
}

async function timed<T>(name: string, fn: () => Promise<T>): Promise<TimedResult<T>> {
  const start = performance.now()
  const result = await fn()
  return {
    name,
    elapsedMs: Math.round((performance.now() - start) * 10) / 10,
    result,
  }
}

async function resolveProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      novelPromotionData: {
        select: {
          id: true,
          lastEpisodeId: true,
        },
      },
    },
  })
  if (!project?.novelPromotionData) {
    throw new Error(`Project not found or not novel-promotion: ${projectId}`)
  }
  return project
}

async function resolveEpisode(novelPromotionProjectId: string, episodeId: string | null) {
  if (episodeId) {
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      select: { id: true, episodeNumber: true, name: true },
    })
    if (episode) return episode
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { novelPromotionProjectId },
    orderBy: { episodeNumber: 'asc' },
    select: { id: true, episodeNumber: true, name: true },
  })
  if (!episode) {
    throw new Error(`No episode found for novelPromotionProjectId=${novelPromotionProjectId}`)
  }
  return episode
}

async function main() {
  const projectId = readArg('projectId') || DEFAULT_PROJECT_ID
  const stage = safeStage(readArg('stage'))
  const project = await resolveProject(projectId)
  const episode = await resolveEpisode(
    project.novelPromotionData.id,
    readArg('episodeId') || project.novelPromotionData.lastEpisodeId,
  )

  const measurements = await Promise.all([
    timed('data-size-counts', async () => {
      const [episodes, clips, storyboards, panels, shots, voiceLines, characters, characterAppearances, locations, locationImages, tasks] = await Promise.all([
        prisma.novelPromotionEpisode.count({ where: { novelPromotionProjectId: project.novelPromotionData.id } }),
        prisma.novelPromotionClip.count({ where: { episodeId: episode.id } }),
        prisma.novelPromotionStoryboard.count({ where: { episodeId: episode.id } }),
        prisma.novelPromotionPanel.count({ where: { storyboard: { episodeId: episode.id } } }),
        prisma.novelPromotionShot.count({ where: { episodeId: episode.id } }),
        prisma.novelPromotionVoiceLine.count({ where: { episodeId: episode.id } }),
        prisma.novelPromotionCharacter.count({ where: { novelPromotionProjectId: project.novelPromotionData.id } }),
        prisma.characterAppearance.count({ where: { character: { novelPromotionProjectId: project.novelPromotionData.id } } }),
        prisma.novelPromotionLocation.count({ where: { novelPromotionProjectId: project.novelPromotionData.id } }),
        prisma.locationImage.count({ where: { location: { novelPromotionProjectId: project.novelPromotionData.id } } }),
        prisma.task.count({ where: { projectId: project.id } }),
      ])
      return { episodes, clips, storyboards, panels, shots, voiceLines, characters, characterAppearances, locations, locationImages, tasks }
    }),
    timed('project-data-light', async () => {
      const data = await prisma.novelPromotionProject.findUnique({
        where: { projectId: project.id },
        include: {
          episodes: {
            orderBy: { episodeNumber: 'asc' },
            include: {
              clips: { where: { screenplay: { not: null }, NOT: { screenplay: '' } }, select: { id: true }, take: 1 },
              storyboards: {
                where: { panels: { some: {} } },
                select: {
                  id: true,
                  panels: { where: { videoUrl: { not: null }, NOT: { videoUrl: '' } }, select: { id: true }, take: 1 },
                },
                take: 1,
              },
              voiceLines: { select: { id: true }, take: 1 },
            },
          },
        },
      })
      return { bytes: bytesOf(data), episodeSummaries: data?.episodes.length ?? 0 }
    }),
    timed('episode-profile-config', async () => {
      const data = await prisma.novelPromotionEpisode.findUnique({
        where: { id: episode.id },
        select: {
          id: true,
          episodeNumber: true,
          name: true,
          novelText: true,
          createdAt: true,
          clips: { select: { id: true, screenplay: true }, where: { AND: [{ screenplay: { not: null } }, { screenplay: { not: '' } }] }, take: 1 },
          storyboards: { select: { id: true, panels: { select: { id: true, videoUrl: true }, where: { AND: [{ videoUrl: { not: null } }, { videoUrl: { not: '' } }] }, take: 1 } }, where: { panels: { some: {} } }, take: 1 },
          voiceLines: { select: { id: true }, take: 1 },
        },
      })
      return { bytes: bytesOf(data) }
    }),
    timed('episode-profile-storyboard-slim', async () => {
      const data = await prisma.novelPromotionEpisode.findUnique({
        where: { id: episode.id },
        select: {
          id: true,
          episodeNumber: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          clips: { orderBy: { createdAt: 'asc' } },
          storyboards: {
            select: {
              id: true,
              episodeId: true,
              clipId: true,
              storyboardTextJson: true,
              panelCount: true,
              storyboardImageUrl: true,
              candidateImages: true,
              lastError: true,
              photographyPlan: true,
              clip: true,
              panels: {
                orderBy: { panelIndex: 'asc' },
                select: {
                  id: true,
                  storyboardId: true,
                  panelIndex: true,
                  panelNumber: true,
                  shotType: true,
                  cameraMove: true,
                  description: true,
                  location: true,
                  characters: true,
                  props: true,
                  srtSegment: true,
                  srtStart: true,
                  srtEnd: true,
                  duration: true,
                  imagePrompt: true,
                  imageModel: true,
                  imageUrl: true,
                  imageMediaId: true,
                  candidateImages: true,
                  imageHistory: true,
                  sketchImageUrl: true,
                  sketchImageMediaId: true,
                  previousImageUrl: true,
                  previousImageMediaId: true,
                  photographyRules: true,
                  actingNotes: true,
                  videoPrompt: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
      return {
        bytesBeforeMediaAttach: bytesOf(data),
        clips: data?.clips.length ?? 0,
        storyboards: data?.storyboards.length ?? 0,
        panels: data?.storyboards.reduce((sum, storyboard) => sum + storyboard.panels.length, 0) ?? 0,
      }
    }),
    timed('previous-video-history', async () => {
      const panels = await prisma.novelPromotionPanel.findMany({
        where: { storyboard: { episodeId: episode.id } },
        select: { id: true },
      })
      const tasks = await prisma.task.findMany({
        where: {
          projectId: project.id,
          type: 'video_panel',
          status: 'completed',
          targetType: 'NovelPromotionPanel',
          targetId: { in: panels.map((panel) => panel.id) },
        },
        select: { id: true, targetId: true, payload: true, result: true },
        orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
      })
      return { panelTargets: panels.length, completedVideoTasks: tasks.length, bytes: bytesOf(tasks) }
    }),
  ])

  console.log(JSON.stringify({
    project: { id: project.id, name: project.name },
    episode,
    stage,
    notes: [
      'All byte sizes are JSON payload estimates before HTTP compression.',
      'This audit intentionally prints aggregate counts and sizes only.',
    ],
    measurements,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
