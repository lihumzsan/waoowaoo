import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
import { TASK_TYPE } from '@/lib/task/types'
import {
  findStructuredStreamAdapters,
  findTextStreamAdapters,
} from '@/features/project-workspace/canvas/structured-stream/structured-stream-adapters'

describe('workspace structured stream adapters', () => {
  it('registers every edit bible streaming prompt step as text for the canvas', () => {
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
      }).map((adapter) => adapter.key)).toEqual(['editBible.text'])
    }
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
      },
    })
  })
})
