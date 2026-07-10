import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
import { TASK_TYPE } from '@/lib/task/types'
import {
  findStructuredStreamAdapters,
  findTextStreamAdapters,
} from '@/features/project-workspace/canvas/structured-stream/structured-stream-adapters'

describe('workspace structured stream adapters', () => {
  it('routes edit bible streaming prompt steps through structured adapters instead of raw text', () => {
    const expectedStructuredKeys = new Map([
      [AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL, ['productionPlanning.globalBible']],
      [AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET, ['productionPlanning.beats']],
      [AI_PROMPT_IDS.EDIT_BIBLE_LEDGER, ['productionPlanning.ledgerEvents']],
      [AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE, ['productionPlanning.emotionalCues']],
    ])

    expect(findStructuredStreamAdapters({
      taskType: TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE,
      stepId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
    }).map((adapter) => adapter.key)).toEqual(['sourceScript.segments'])

    for (const stepId of expectedStructuredKeys.keys()) {
      expect(findTextStreamAdapters({
        taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
        stepId,
      })).toEqual([])
      expect(findStructuredStreamAdapters({
        taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
        stepId,
      }).map((adapter) => adapter.key)).toEqual(expectedStructuredKeys.get(stepId))
    }
  })

  it('does not expose edit bible prompt steps through the legacy text adapter', () => {
    for (const stepId of [
      AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
      AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL,
      AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET,
      AI_PROMPT_IDS.EDIT_BIBLE_LEDGER,
      AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE,
    ]) {
      expect(findTextStreamAdapters({
        taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
        stepId,
      })).toEqual([])
    }
    expect(findTextStreamAdapters({
      taskType: TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE,
      stepId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
    })).toEqual([])
  })

  it('routes edit script structure stream items through shotId keyed adapters', () => {
    const [adapter] = findStructuredStreamAdapters({
      taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      stepId: AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE,
    })

    expect(adapter?.key).toBe('editScript.shots')
    expect(adapter?.itemKey({
      kind: 'editScriptShot',
      shot: {
        shotId: 'shot-stable-id',
        shotNumber: 1,
        shotPurpose: 'action',
        durationSec: 4,
        scene: {
          locationId: 'location-1',
          name: '地下室',
          subScene: '工作台',
        },
        action: '民科检查设备。',
        characters: [{
          characterId: 'character-1',
          name: '民科',
          visibility: 'visible',
          role: 'focus',
          performance: '检查设备',
        }],
        keyObjects: [],
        dialogue: [{
          characterId: 'character-1',
          line: '设备开始倒转了。',
        }],
        sound: 'room tone',
      },
    }, 0)).toBe('shot-stable-id')
  })

  it('accepts raw chapter planning stream shots before asset names are enriched for persistence', () => {
    const [adapter] = findStructuredStreamAdapters({
      taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      stepId: AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE,
    })

    const parsed = adapter?.parseItem({
      shotId: 'shot-stream-id',
      shotNumber: 1,
      shotPurpose: 'action',
      durationSec: 4,
      scene: {
        locationId: 'location-1',
        subScene: '工作台',
      },
      action: '民科检查设备。',
      characters: [{
        characterId: 'character-1',
        visibility: 'visible',
        role: 'focus',
        performance: '检查设备',
      }],
      keyObjects: [],
      dialogue: [{
        characterId: 'character-1',
        line: '设备开始倒转了。',
      }],
      sound: 'room tone',
    })

    expect(parsed).toMatchObject({
      kind: 'editScriptShot',
      shot: {
        shotId: 'shot-stream-id',
        scene: {
          locationId: 'location-1',
          name: 'location-1',
          subScene: '工作台',
        },
        characters: [{
          characterId: 'character-1',
          name: 'character-1',
        }],
        dialogue: [{
          characterId: 'character-1',
          line: '设备开始倒转了。',
        }],
      },
    })
  })

  it('routes soundscape plan streams through source and section adapters', () => {
    const adapters = findStructuredStreamAdapters({
      taskType: TASK_TYPE.SOUNDSCAPE_PLAN,
      stepId: 'soundscape_plan',
    })

    expect(adapters.map((adapter) => adapter.key)).toEqual([
      'soundscape.sources',
      'soundscape.sections',
    ])

    const sourceAdapter = adapters.find((adapter) => adapter.key === 'soundscape.sources')
    const sectionAdapter = adapters.find((adapter) => adapter.key === 'soundscape.sections')

    const parsedSource = sourceAdapter?.parseItem({
      sourceId: 'city_rooftop_wind',
      environmentFingerprint: 'night_city_rooftop_wind',
      prompt: 'Seamless loop of steady rooftop wind with distant city hum, no music, no voices.',
      loopDurationSeconds: 30,
      promptInfluence: 0.55,
    })
    const parsedSection = sectionAdapter?.parseItem({
      sourceId: 'city_rooftop_wind',
      fromShotId: 'shot_012',
      toShotId: 'shot_018',
      perspective: 'exterior_near',
      intensity: 'medium',
      transitionIn: 'fade',
      transitionOut: 'crossfade',
    })

    expect(parsedSource).toMatchObject({
      kind: 'soundscapeSource',
      source: {
        sourceId: 'city_rooftop_wind',
        environmentFingerprint: 'night_city_rooftop_wind',
      },
    })
    expect(parsedSection).toMatchObject({
      kind: 'soundscapeSection',
      section: {
        sourceId: 'city_rooftop_wind',
        fromShotId: 'shot_012',
        toShotId: 'shot_018',
      },
    })
  })
})
