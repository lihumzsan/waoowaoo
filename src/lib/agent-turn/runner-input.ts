import type { AgentInputItem } from '@openai/agents'
import type { UIMessage } from 'ai'
import {
  readProjectCreativeResourceWorkingSet,
  type CreativeResourceWorkingSetView,
} from '@/lib/creative-resource'
import { prisma } from '@/lib/prisma'
import {
  appendProjectAssistantMediaAttachmentsToUserText,
  readProjectAssistantMediaAttachmentsFromMessage,
} from '@/lib/project-agent/media-attachments'
import { buildProjectAssistantImageInputParts } from '@/lib/project-agent/media-attachments/model-input-protocol'
import type { ProjectAgentPlanSnapshot } from '@/lib/project-agent/plan'
import {
  appendProjectAssistantTextAttachmentsToUserText,
  readProjectAssistantTextAttachmentsFromMessage,
} from '@/lib/project-agent/text-attachments'
import { deriveAgentTurnUserEvidence } from './user-evidence'

export function buildAgentTurnUserInputItem(
  message: UIMessage,
): AgentInputItem {
  if (message.role !== 'user') {
    throw new Error('AGENT_TURN_USER_MESSAGE_ROLE_INVALID')
  }
  const media = readProjectAssistantMediaAttachmentsFromMessage(message)
  const evidence = deriveAgentTurnUserEvidence(message)
  const content = appendProjectAssistantMediaAttachmentsToUserText({
    userText: appendProjectAssistantTextAttachmentsToUserText({
      userText: evidence.text ?? '',
      attachments: readProjectAssistantTextAttachmentsFromMessage(message),
    }),
    attachments: media,
  })
  if (!content.trim()) throw new Error('AGENT_TURN_USER_CONTENT_REQUIRED')
  const images = buildProjectAssistantImageInputParts(media)
  return {
    role: 'user',
    content: images.length > 0
      ? [
          { type: 'input_text', text: content },
          ...images,
        ]
      : content,
  } satisfies AgentInputItem
}

interface ProjectRuntimeFacts {
  planning: {
    storyCanonVersion: number | null
    screenplayResourceId: string | null
    storyCanonResourceId: string | null
    chapterCount: number
  }
}

async function readProjectRuntimeFacts(params: {
  projectId: string
  userId: string
  episodeId: string | null
}): Promise<ProjectRuntimeFacts> {
  const [storyCanon, chapterCount] = await Promise.all([
    params.episodeId
      ? prisma.projectStoryCanon.findFirst({
          where: {
            episodeId: params.episodeId,
            episode: {
              projectId: params.projectId,
              project: { userId: params.userId },
            },
          },
          select: {
            version: true,
            storyCanonResourceId: true,
            sourceDocument: {
              select: { sourceResourceId: true },
            },
          },
        })
      : Promise.resolve(null),
    params.episodeId
      ? prisma.projectEditChapter.count({
          where: {
            episodeId: params.episodeId,
            episode: {
              projectId: params.projectId,
              project: { userId: params.userId },
            },
          },
        })
      : Promise.resolve(0),
  ])
  return {
    planning: {
      storyCanonVersion: storyCanon?.version ?? null,
      screenplayResourceId:
        storyCanon?.sourceDocument.sourceResourceId ?? null,
      storyCanonResourceId: storyCanon?.storyCanonResourceId ?? null,
      chapterCount,
    },
  }
}

function display(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') || 'none'
}

function buildStateVersion(params: {
  videoRatio: string | null
  facts: ProjectRuntimeFacts
  creativeWorkingSet: CreativeResourceWorkingSetView
}): string {
  return [
    params.videoRatio ?? 'none',
    String(params.facts.planning.storyCanonVersion ?? 'none'),
    params.facts.planning.screenplayResourceId ?? 'none',
    params.facts.planning.storyCanonResourceId ?? 'none',
    String(params.facts.planning.chapterCount),
    params.creativeWorkingSet.adoptedCreativeDirection?.resourceId ?? 'none',
    ...params.creativeWorkingSet.currentSelections.map(
      (selection) => `${selection.kind}:${selection.targetId}:${selection.resourceId}`,
    ),
  ].map(display).join(':')
}

export async function buildAgentTurnProjectStateInput(params: {
  projectId: string
  userId: string
  episodeId: string | null
}): Promise<AgentInputItem> {
  const [facts, project, creativeWorkingSet] = await Promise.all([
    readProjectRuntimeFacts(params),
    prisma.project.findFirst({
      where: { id: params.projectId, userId: params.userId },
      select: { videoRatio: true },
    }),
    readProjectCreativeResourceWorkingSet(params),
  ])
  if (!project) {
    throw new Error(`AGENT_TURN_PROJECT_NOT_FOUND:${params.projectId}`)
  }
  return {
    role: 'system',
    content: [
      '[project_state_snapshot]',
      `version=${buildStateVersion({
        videoRatio: project.videoRatio,
        facts,
        creativeWorkingSet,
      })}`,
      `projectId=${display(params.projectId)}`,
      `episodeId=${display(params.episodeId)}`,
      `config.videoRatio=${display(project.videoRatio)}`,
      `planning.storyCanonVersion=${display(String(facts.planning.storyCanonVersion ?? 'none'))}`,
      `planning.screenplayResourceId=${display(facts.planning.screenplayResourceId)}`,
      `planning.storyCanonResourceId=${display(facts.planning.storyCanonResourceId)}`,
      `planning.chapterCount=${String(facts.planning.chapterCount)}`,
      `creativeWorkingSet.adoptedCreativeDirection=${JSON.stringify(creativeWorkingSet.adoptedCreativeDirection)}`,
      `creativeWorkingSet.adoptedAssetManifest=${JSON.stringify(creativeWorkingSet.adoptedAssetManifest)}`,
      `creativeWorkingSet.currentSelections=${JSON.stringify(creativeWorkingSet.currentSelections)}`,
      `creativeWorkingSet.availableResources=${JSON.stringify(creativeWorkingSet.availableResources)}`,
      '[/project_state_snapshot]',
    ].join('\n'),
  } as AgentInputItem
}

export function buildAgentTurnPlanInputItem(
  plan: ProjectAgentPlanSnapshot,
): AgentInputItem {
  return {
    role: 'system',
    content: [
      '[agent_plan]',
      JSON.stringify(plan),
      '[/agent_plan]',
    ].join('\n'),
  } as AgentInputItem
}
