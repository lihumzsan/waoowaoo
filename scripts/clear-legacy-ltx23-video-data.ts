import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isRemovedLegacyLtx23WorkflowKey } from '@/lib/providers/comfyui/ltx23-legacy'
import { COMFYUI_SEEDANCE2_BERNINI_MODEL_KEY } from '@/lib/providers/comfyui/seedance2-bernini-workflow'
import { TASK_TYPE } from '@/lib/task/types'
import {
  collectLegacyPanelIdsToClear,
  removeLegacyCapabilitySelections,
  removeLegacyCustomModels,
  taskReferencesLegacyLtx23,
} from './clear-legacy-ltx23-video-data-core'

type Args = {
  apply: boolean
  project?: string
  projectName?: string
  projectId?: string
  clearPanelVideos: boolean
}

const NEW_DEFAULT_VIDEO_MODEL = COMFYUI_SEEDANCE2_BERNINI_MODEL_KEY
const CLEANUP_TASK_TYPES = [TASK_TYPE.VIDEO_PANEL, TASK_TYPE.LIP_SYNC]

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, clearPanelVideos: true }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--apply') args.apply = true
    else if (item === '--dry-run') args.apply = false
    else if (item === '--keep-panel-videos') args.clearPanelVideos = false
    else if (item === '--project') args.project = argv[++index]
    else if (item === '--project-name') args.projectName = argv[++index]
    else if (item === '--project-id') args.projectId = argv[++index]
  }
  return args
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

function buildProjectWhere(args: Args): Prisma.NovelPromotionProjectWhereInput {
  const filters: Prisma.NovelPromotionProjectWhereInput[] = []
  if (args.projectId) filters.push({ projectId: args.projectId })
  if (args.projectName) filters.push({ project: { name: args.projectName } })
  if (args.project) {
    filters.push({ projectId: args.project })
    filters.push({ project: { name: args.project } })
  }
  return filters.length > 0 ? { OR: filters } : {}
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const hasProjectFilter = Boolean(args.project || args.projectId || args.projectName)
  const projects = await prisma.novelPromotionProject.findMany({
    where: buildProjectWhere(args),
    include: {
      project: { select: { id: true, name: true, userId: true } },
      episodes: {
        select: {
          storyboards: {
            select: {
              panels: { select: { id: true } },
            },
          },
        },
      },
    },
  })

  const projectIds = projects.map((project) => project.projectId)
  const legacyVideoModelProjects = projects.filter((project) => isRemovedLegacyLtx23WorkflowKey(project.videoModel))
  const legacyProjectIds = legacyVideoModelProjects.map((project) => project.projectId)
  const legacyProjectPanelIds = legacyVideoModelProjects.flatMap((project) =>
    project.episodes.flatMap((episode) =>
      episode.storyboards.flatMap((storyboard) => storyboard.panels.map((panel) => panel.id)),
    ),
  )

  const projectCapabilityUpdates = projects
    .map((project) => ({
      project,
      cleaned: removeLegacyCapabilitySelections(project.capabilityOverrides),
    }))
    .filter((item) => item.cleaned.changed)

  const tasks = projectIds.length > 0
    ? await prisma.task.findMany({
        where: {
          projectId: { in: projectIds },
          type: { in: CLEANUP_TASK_TYPES },
        },
        select: {
          id: true,
          projectId: true,
          type: true,
          targetId: true,
          payload: true,
          result: true,
          billingInfo: true,
        },
      })
    : []
  const panelIdsToClear = collectLegacyPanelIdsToClear(legacyProjectPanelIds, tasks)
  const legacyProjectPanelIdSet = new Set(legacyProjectPanelIds)
  const legacyTaskIds = tasks
    .filter((task) =>
      legacyProjectPanelIdSet.has(task.targetId)
      || taskReferencesLegacyLtx23(task))
    .map((task) => task.id)
  const [taskEventsToDelete, graphRunsToDelete] = legacyTaskIds.length > 0
    ? await Promise.all([
        prisma.taskEvent.count({ where: { taskId: { in: legacyTaskIds } } }),
        prisma.graphRun.count({ where: { taskId: { in: legacyTaskIds } } }),
      ])
    : [0, 0]

  const userWhere: Prisma.UserPreferenceWhereInput = hasProjectFilter
    ? { userId: { in: uniqueStrings(projects.map((project) => project.project.userId)) } }
    : {}
  const preferences = await prisma.userPreference.findMany({
    where: userWhere,
    select: {
      id: true,
      userId: true,
      videoModel: true,
      customModels: true,
      capabilityDefaults: true,
    },
  })
  const legacyUserVideoModelPreferences = preferences.filter((pref) => isRemovedLegacyLtx23WorkflowKey(pref.videoModel))
  const customModelUpdates = preferences
    .map((pref) => ({ pref, cleaned: removeLegacyCustomModels(pref.customModels) }))
    .filter((item) => item.cleaned.changed)
  const userCapabilityUpdates = preferences
    .map((pref) => ({ pref, cleaned: removeLegacyCapabilitySelections(pref.capabilityDefaults) }))
    .filter((item) => item.cleaned.changed)

  const summary = {
    mode: args.apply ? 'apply' : 'dry-run',
    projectFilter: args.project || args.projectName || args.projectId || null,
    newDefaultVideoModel: NEW_DEFAULT_VIDEO_MODEL,
    projectsScanned: projects.length,
    projectVideoModelsToReset: legacyVideoModelProjects.map((project) => ({
      projectId: project.projectId,
      name: project.project.name,
      oldVideoModel: project.videoModel,
    })),
    userVideoModelsToReset: legacyUserVideoModelPreferences.map((pref) => ({
      userId: pref.userId,
      oldVideoModel: pref.videoModel,
    })),
    projectCapabilityOverridesToUpdate: projectCapabilityUpdates.length,
    userCapabilityDefaultsToUpdate: userCapabilityUpdates.length,
    customModelsToRemove: customModelUpdates.reduce((sum, item) => sum + item.cleaned.removed, 0),
    panelVideosToClear: args.clearPanelVideos ? panelIdsToClear.length : 0,
    legacyTasksToDelete: legacyTaskIds.length,
    taskEventsToDelete,
    graphRunsToDelete,
  }

  console.log(JSON.stringify(summary, null, 2))

  if (!args.apply) return

  await prisma.$transaction(async (tx) => {
    for (const project of legacyVideoModelProjects) {
      await tx.novelPromotionProject.update({
        where: { id: project.id },
        data: { videoModel: NEW_DEFAULT_VIDEO_MODEL },
      })
    }

    for (const item of projectCapabilityUpdates) {
      await tx.novelPromotionProject.update({
        where: { id: item.project.id },
        data: { capabilityOverrides: item.cleaned.value },
      })
    }

    for (const pref of legacyUserVideoModelPreferences) {
      await tx.userPreference.update({
        where: { id: pref.id },
        data: { videoModel: NEW_DEFAULT_VIDEO_MODEL },
      })
    }

    for (const item of customModelUpdates) {
      await tx.userPreference.update({
        where: { id: item.pref.id },
        data: { customModels: item.cleaned.value },
      })
    }

    for (const item of userCapabilityUpdates) {
      await tx.userPreference.update({
        where: { id: item.pref.id },
        data: { capabilityDefaults: item.cleaned.value },
      })
    }

    if (args.clearPanelVideos && panelIdsToClear.length > 0) {
      await tx.novelPromotionPanel.updateMany({
        where: { id: { in: panelIdsToClear } },
        data: {
          videoUrl: null,
          videoMediaId: null,
          videoGenerationMode: null,
          lipSyncTaskId: null,
          lipSyncVideoUrl: null,
          lipSyncVideoMediaId: null,
        },
      })
    }

    if (legacyTaskIds.length > 0) {
      await tx.graphRun.deleteMany({ where: { taskId: { in: legacyTaskIds } } })
      await tx.taskEvent.deleteMany({ where: { taskId: { in: legacyTaskIds } } })
      await tx.task.deleteMany({ where: { id: { in: legacyTaskIds } } })
    }
  })

  if (legacyProjectIds.length > 0) {
    console.log(JSON.stringify({ applied: true, resetProjectIds: legacyProjectIds }, null, 2))
  } else {
    console.log(JSON.stringify({ applied: true, resetProjectIds: [] }, null, 2))
  }
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
