'use client'

// Subagent 的本地化投影与共享状态图形。
// 只做纯展示投影,不解释任何生命周期事实(状态权威仍是 Task.status)。

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { getCreativeSkillDefinition } from '@/lib/creative-skills/registry'
import { isCreativeSkillId } from '@/lib/creative-skills/uri'
import type {
  ProjectAgentSubagentEventPartData,
  ProjectAgentSubagentStatus,
  ProjectAgentSubagentView,
} from '@/lib/project-agent/subagent-events'

export type AssistantAgentTranslator = ReturnType<typeof useTranslations<'assistantAgent'>>
export type ErrorTranslator = ReturnType<typeof useTranslations<'errors'>>
export type SubagentReasoningEvent = Extract<
  ProjectAgentSubagentEventPartData['event'],
  { kind: 'reasoning' }
>

export function localizeOutputKind(
  outputKind: ProjectAgentSubagentView['outputKind'],
  t: AssistantAgentTranslator,
): string {
  switch (outputKind) {
    case 'screenplay': return t('subagents.outputKinds.screenplay')
    case 'story_canon': return t('subagents.outputKinds.storyCanon')
    case 'continuity_analysis': return t('subagents.outputKinds.continuityAnalysis')
    case 'chapter_plan': return t('subagents.outputKinds.chapterPlan')
    case 'creative_direction': return t('subagents.outputKinds.creativeDirection')
    case 'asset_manifest': return t('subagents.outputKinds.assetManifest')
    case 'video_prompt_set': return t('subagents.outputKinds.videoPromptSet')
    case 'music_direction': return t('subagents.outputKinds.musicDirection')
    // Historical tasks may record kinds removed from the registry.
    default: return outputKind
  }
}

function creativeSkillTitle(skillId: string): string {
  // Historical traces may reference skills removed from the registry.
  return isCreativeSkillId(skillId) ? getCreativeSkillDefinition(skillId).title : skillId
}

export function localizeEvent(
  part: ProjectAgentSubagentEventPartData,
  t: AssistantAgentTranslator,
): string {
  const event = part.event
  switch (event.kind) {
    case 'started': return t('subagents.events.started')
    case 'skill_read':
      return t('subagents.events.skillRead', {
        skill: creativeSkillTitle(event.trace.skillId),
      })
    case 'reasoning':
      return event.status === 'running'
        ? t('subagents.events.reasoningRunning')
        : t('subagents.events.reasoningCompleted')
    case 'tool_called':
      return t('subagents.events.toolCalled', {
        skill: creativeSkillTitle(event.skillId),
      })
    case 'tool_completed':
      return t('subagents.events.toolCompleted', {
        skill: creativeSkillTitle(event.skillId),
      })
    case 'tool_failed':
      return t('subagents.events.toolFailed', {
        skill: creativeSkillTitle(event.skillId),
      })
    case 'research_started':
      return t('subagents.events.researchStarted', { query: event.query })
    case 'research_completed':
      return event.status === 'completed'
        ? t('subagents.events.researchCompleted', {
            sources: event.sourceCount,
            images: event.imageCount,
          })
        : t('subagents.events.researchUnavailable')
  }
}

export function localizeStatus(status: ProjectAgentSubagentStatus, t: AssistantAgentTranslator): string {
  if (status === 'running') return t('subagents.status.running')
  if (status === 'completed') return t('subagents.status.completed')
  if (status === 'failed') return t('subagents.status.failed')
  return t('subagents.status.cancelled')
}

export function StatusGlyph({ status }: { status: ProjectAgentSubagentStatus }) {
  if (status === 'running') {
    return <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white" aria-hidden="true">
        <AppIcon name="check" className="h-2.5 w-2.5" />
      </span>
    )
  }
  return <AppIcon name="alert" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
}
