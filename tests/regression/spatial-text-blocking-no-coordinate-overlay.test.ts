import { describe, expect, it } from 'vitest'
import { buildStoryboardStillPromptFacts } from '@/lib/edit-script/prompt-builders'
import type { EditGenerationSegment, EditScriptShot, EditShotExecution } from '@/lib/edit-script/types'
import { buildZenStyleBibleFixture } from '../fixtures/edit-script-style-bible'

const shot: EditScriptShot = {
  shotNumber: 1,
  durationSec: 3,
  scene: { name: '老店室内' },
  action: '人物从门口走到柜台前停下。',
  characters: [
    {
      name: '店主',
      visibility: 'visible',
      role: 'focus',
      performance: '停在柜台前观察窗外',
    },
  ],
  keyObjects: [
    { name: '木质柜台', role: 'spatial_anchor' },
  ],
  sound: '室内安静，远处传来街声。',
}

const execution: EditShotExecution = {
  shotNumber: 1,
  camera: {
    shotScale: '中景',
    lens: '35mm',
    focus: '人物和柜台清晰',
    height: '视线高度',
    angle: '平视',
    movement: '固定机位',
    composition: '人物站在门廊左侧阴影里，柜台保持画面右侧',
    lighting: '光线从右后方窗户照入',
  },
  blocking: {
    axis: {
      type: 'subject_line',
      subjects: ['店主', '木质柜台'],
      screenDirection: '店主保持画面左侧，柜台保持画面右侧',
    },
    characters: [
      {
        name: '店主',
        visibility: 'visible',
        position: '柜台前方',
        screenPosition: '画面左三分之一',
        facing: '面向柜台',
        eyeline: '看向窗户方向',
      },
    ],
    objects: [
      {
        name: '木质柜台',
        position: '室内右侧中景',
        screenPosition: '画面右侧',
      },
    ],
    spatialNote: '门廊连接柜台和窗边座位。',
  },
}

const segment: EditGenerationSegment = {
  shotNumbers: [1],
  continuity: '人物从门口移动到柜台前，空间左右关系保持不变。',
}

describe('spatial text blocking regression', () => {
  it('renders structured blocking facts without coordinate overlay fields', () => {
    const result = buildStoryboardStillPromptFacts({
      shot,
      execution,
      segment,
      sourceGenerationSegmentId: 'edit-1:generationSegment:1',
      assets: [],
      styleBible: buildZenStyleBibleFixture(),
    })

    expect(result.prompt).toContain('人物站在门廊左侧阴影里')
    expect(result.prompt).toContain('木质柜台')
    expect(result.prompt).toContain('门廊连接柜台和窗边座位')
    expect(result.prompt).not.toContain('placementZones')
    expect(result.prompt).not.toContain('"x"')
    expect(result.prompt).not.toContain('"y"')
  })
})
