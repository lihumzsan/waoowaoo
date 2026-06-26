import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import { editCinematographyShotPlanSchema } from '@/lib/edit-script/types'

describe('edit script cinematography shot plan', () => {
  it('accepts concrete per-shot cinematography parameters', () => {
    const parsed = editCinematographyShotPlanSchema.parse({
      strategy: 'cinematography_shot_plan',
      schemaVersion: 1,
      shots: [
        {
          shotNumber: 1,
          shotScale: 'Close shot',
          lens: '50mm',
          depthOfField: 'Shallow depth; hand and door gap are sharp, background is soft.',
          cameraPosition: 'Right-front medium distance from the protagonist.',
          cameraHeight: 'Slightly below eye level.',
          cameraAngle: 'Slight side angle.',
          movement: 'Static camera.',
          composition: 'The hand sits low-center while the dark door gap holds the background side.',
          lighting: 'Weak cool rim light from inside the door outlines the hand.',
          axisAndEyeline: 'Keep the door on screen left and the protagonist eyeline into the room.',
          continuityIn: 'Connect from footsteps stopping.',
          continuityOut: 'Continue along the protagonist eyeline.',
        },
      ],
    })

    expect(parsed.shots[0]?.lens).toBe('50mm')
    expect(parsed.shots[0]?.axisAndEyeline).toContain('screen left')
    expect(Object.prototype.hasOwnProperty.call(parsed, 'hardBans')).toBe(false)
  })

  it('rejects shot plans without lens and axis continuity', () => {
    const result = editCinematographyShotPlanSchema.safeParse({
      strategy: 'cinematography_shot_plan',
      schemaVersion: 1,
      shots: [
        {
          shotNumber: 1,
          shotScale: 'Close shot',
          depthOfField: 'Shallow depth.',
          cameraPosition: 'Right-front medium distance.',
          cameraHeight: 'Slightly below eye level.',
          cameraAngle: 'Slight side angle.',
          movement: 'Static camera.',
          composition: 'Hand low-center.',
          lighting: 'Cool rim light.',
          continuityIn: 'Connect from previous shot.',
          continuityOut: 'Continue to next shot.',
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('prompts the cinematography module to cover all shots with concrete camera execution', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_CINEMATOGRAPHY_SHOT_PLAN,
      locale: 'en',
      variables: {
        style_bible_json: JSON.stringify({ stylePolicy: { directing: {}, camera: {}, visual: {}, sound: {} } }),
        director_decoupage_json: JSON.stringify({ shots: [{ shotNumber: 1, visibleAction: 'A protagonist waits.' }] }),
        edit_script_json: JSON.stringify({ shots: [{ shotNumber: 1 }], videoBlocks: [] }),
        asset_context_json: JSON.stringify({ assets: [] }),
        spatial_profiles_json: JSON.stringify({ locations: [] }),
      },
    })

    expect(prompt).toContain('Cinematography Shot Plan')
    expect(prompt).toContain('shotScale')
    expect(prompt).toContain('lens')
    expect(prompt).toContain('axisAndEyeline')
    expect(prompt).toContain('"movement" is required')
    expect(prompt).toContain('The Schema below is the contract, not an example to paraphrase')
    expect(prompt).toContain('Do not omit fields, add fields, rename fields, or use aliases')
    expect(prompt).toContain('Do not replace movement with cameraMovement, cameraMove, move, or localized field names')
    expect(prompt).toContain('"lighting" is the only valid lighting field key')
    expect(prompt).toContain('Do not output lightning, light, lightingPrompt, or localized field names')
    expect(prompt).toContain('every string value in shots[].* must be English natural language')
    expect(prompt).not.toContain('hardBans')
    expect(prompt).toContain('do not output Chinese words or Chinese sentences')
    expect(prompt).toContain('Do not append localized labels in parentheses')
    expect(prompt).toContain('Before returning, validate every shot has these fields')
    expect(prompt).toContain('cameraAngle, movement, composition')
    expect(prompt).toContain('must cover all shots in one pass')
  })

  it('regresses Chinese cinematography prompts to ban English values in shot plan output', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_CINEMATOGRAPHY_SHOT_PLAN,
      locale: 'zh',
      variables: {
        style_bible_json: JSON.stringify({ stylePolicy: { directing: {}, camera: {}, visual: {}, sound: {} } }),
        director_decoupage_json: JSON.stringify({ shots: [{ shotNumber: 4, visibleAction: '角色在床边抚摸狗狗。' }] }),
        edit_script_json: JSON.stringify({ shots: [{ shotNumber: 4 }], videoBlocks: [] }),
        asset_context_json: JSON.stringify({ assets: [] }),
        spatial_profiles_json: JSON.stringify({ locations: [] }),
      },
    })

    expect(prompt).toContain('"movement" 是必填字段')
    expect(prompt).toContain('下面的 Schema 是输出契约，不是可以改写的示例')
    expect(prompt).toContain('不得漏字段、不得新增字段、不得改名、不得使用别名')
    expect(prompt).toContain('禁止用 cameraMovement、cameraMove、move 或中文字段名替代 movement')
    expect(prompt).toContain('"lighting" 是唯一合法的光线字段名')
    expect(prompt).toContain('禁止输出 lightning、light、lightingPrompt 或中文字段名')
    expect(prompt).toContain('所有字段值必须整体使用中文自然语言')
    expect(prompt).toContain('不得输出英文单词或英文句子')
    expect(prompt).toContain('不要附加括号英文译名')
    expect(prompt).toContain('不要输出“全景 (Full Shot)”或“retro game”')
    expect(prompt).toContain('输出前逐个检查每个 shot 是否都有这些字段')
    expect(prompt).toContain('cameraAngle、movement、composition')
  })
})
