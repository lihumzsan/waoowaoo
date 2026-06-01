import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'

const storyboardTextJsonInput = JSON.stringify({
  panel: {
    panel_id: 'panel-1',
    shot_blocking: {
      absolutePosition: '人物站在门廊左侧阴影里',
      relativePosition: '人物位于柜台前方，背后是窗户',
      screenPosition: '画面左三分之一',
      cameraPlacement: '从门口内侧斜拍向柜台',
    },
  },
  context: {
    location_reference: {
      spatial_profile: {
        schemaVersion: 1,
        sceneSummary: '老店室内，门廊连接柜台和窗边座位。',
        anchors: [{
          id: 'counter',
          label: '木质柜台',
          screenArea: '画面右侧',
          depthLayer: '中景',
          spatialRelations: ['柜台前方留出人物站位', '窗户在柜台后方'],
        }],
        depthLayout: {
          foreground: '门口阴影',
          midground: '柜台前站位',
          background: '窗边座位',
        },
        lightingDirection: '光线从右后方窗户照入',
      },
    },
  },
})

function buildRenderedPanelPrompt(locale: 'en' | 'zh'): string {
  return buildAiPrompt({
    promptId: AI_PROMPT_IDS.PANEL_IMAGE_GENERATE,
    locale,
    variables: {
      aspect_ratio: '16:9',
      storyboard_text_json_input: storyboardTextJsonInput,
      source_text: '人物从门口走到柜台前停下。',
      style: 'cinematic realistic',
    },
  })
}

describe('spatial text blocking regression', () => {
  it('renders panel image prompts from spatial text context without coordinate fields', () => {
    const renderedPrompts = [
      buildRenderedPanelPrompt('en'),
      buildRenderedPanelPrompt('zh'),
    ]

    for (const renderedPrompt of renderedPrompts) {
      expect(renderedPrompt).toContain('shot_blocking')
      expect(renderedPrompt).toContain('spatial_profile')
      expect(renderedPrompt).toContain('人物站在门廊左侧阴影里')
      expect(renderedPrompt).toContain('木质柜台')
      expect(renderedPrompt).not.toContain('placementZones')
      expect(renderedPrompt).not.toContain('available_slots')
      expect(renderedPrompt).not.toContain('"x"')
      expect(renderedPrompt).not.toContain('"y"')
    }
  })
})
