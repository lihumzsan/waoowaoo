import { describe, expect, it } from 'vitest'
import {
  buildEpisodePlanningOverview,
  formatEpisodePlanningDuration,
  readEpisodePlanningBibleStats,
} from '@/features/project-workspace/episode-planning-overview'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { ProjectEditChapter } from '@/types/project'

const workflow: EditFirstWorkflowState = {
  active: true,
  stage: 'bible_ready_for_review',
  blocking: {
    kind: 'needs_user_choice',
    reason: 'review the episode plan',
  },
  nextAction: {
    id: 'confirm_bible',
    operationId: 'confirm_bible',
    title: 'Confirm episode plan',
    requiresUserConfirmation: true,
  },
  allowedOperationIds: ['confirm_bible', 'revise_bible'],
}

const chapters: ProjectEditChapter[] = [
  {
    id: 'chapter-1',
    chapterIndex: 0,
    title: '开端',
    summary: '主角进入雨夜城市。',
    sourceStart: 0,
    sourceEnd: 200,
    targetDurationSec: 75,
    beatIds: ['beat-1'],
    eventIds: ['event-1'],
    status: 'confirmed',
    renderStatus: 'completed',
    outputMediaId: 'media-1',
  },
  {
    id: 'chapter-2',
    chapterIndex: 1,
    title: '追逐',
    summary: '冲突升级。',
    sourceStart: 201,
    sourceEnd: 420,
    targetDurationSec: 85,
    beatIds: ['beat-2'],
    eventIds: ['event-2'],
    status: 'generating',
    renderStatus: 'processing',
    outputMediaId: null,
  },
  {
    id: 'chapter-3',
    chapterIndex: 2,
    title: '失败',
    summary: '章节渲染失败。',
    sourceStart: 421,
    sourceEnd: 600,
    targetDurationSec: 40,
    beatIds: ['beat-3'],
    eventIds: ['event-3'],
    status: 'ready',
    renderStatus: 'failed',
    outputMediaId: null,
  },
]

describe('episode planning overview', () => {
  it('keeps global bible, beat, ledger, emotion, duration, and chapter status counts together', () => {
    const overview = buildEpisodePlanningOverview({
      workflow,
      editBible: {
        status: 'ready_for_review',
        bible: {
          title: '雨城',
          characters: [{ name: 'A' }, { name: 'B' }],
          locations: [{ name: '街道' }],
          worldRules: ['雨永不停'],
        },
        beatSheet: {
          beats: [{ beatId: 'beat-1' }, { beatId: 'beat-2' }, { beatId: 'beat-3' }],
        },
        ledger: {
          events: [{ eventId: 'event-1' }, { eventId: 'event-2' }],
        },
        emotionalCurve: {
          cues: [{ cueId: 'cue-1' }],
        },
        chapters,
      },
    })

    expect(overview.workflowStage).toBe('bible_ready_for_review')
    expect(overview.blockingKind).toBe('needs_user_choice')
    expect(overview.bibleStatus).toBe('ready_for_review')
    expect(overview.bible).toEqual({
      title: '雨城',
      characterCount: 2,
      locationCount: 1,
      worldRuleCount: 1,
      beatCount: 3,
      ledgerEventCount: 2,
      emotionalCueCount: 1,
    })
    expect(overview.chapterCount).toBe(3)
    expect(overview.targetDurationSec).toBe(200)
    expect(overview.confirmedChapterCount).toBe(1)
    expect(overview.renderedChapterCount).toBe(1)
    expect(overview.processingChapterCount).toBe(1)
    expect(overview.failedChapterCount).toBe(1)
    expect(overview.chapters.map((chapter) => chapter.id)).toEqual(['chapter-1', 'chapter-2', 'chapter-3'])
  })

  it('formats duration as minutes and seconds', () => {
    expect(formatEpisodePlanningDuration(0)).toBe('0:00')
    expect(formatEpisodePlanningDuration(65.4)).toBe('1:05')
    expect(formatEpisodePlanningDuration(600)).toBe('10:00')
  })

  it('returns zero stats when no structured bible is available', () => {
    expect(readEpisodePlanningBibleStats(null)).toEqual({
      title: null,
      characterCount: 0,
      locationCount: 0,
      worldRuleCount: 0,
      beatCount: 0,
      ledgerEventCount: 0,
      emotionalCueCount: 0,
    })
  })
})
