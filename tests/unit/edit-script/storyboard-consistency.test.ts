import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateStoryboardPanelVisualPlan } from '@/lib/edit-script/storyboard-consistency/model-generation'
import type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'

const promptMock = vi.hoisted(() => ({
  buildAiPrompt: vi.fn((input: { promptId: string; variables: Record<string, string> }) => JSON.stringify(input)),
}))

const aiExecMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

vi.mock('@/lib/ai-prompts', () => ({
  AI_PROMPT_IDS: {
    EDIT_SCRIPT_STORYBOARD_CAMERA_STYLE_BIBLE: 'edit-script-storyboard-camera-style-bible',
    EDIT_SCRIPT_STORYBOARD_PANEL_VISUAL_PLAN_BLOCK: 'edit-script-storyboard-panel-visual-plan-block',
  },
  buildAiPrompt: promptMock.buildAiPrompt,
}))

vi.mock('@/lib/ai-exec/engine', () => aiExecMock)

function buildSourceSnapshot(): StoryboardConsistencySourceSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    episodeId: 'episode-1',
    sourceEditScriptId: 'edit-1',
    project: {
      videoRatio: '16:9',
    },
    editScript: {
      id: 'edit-1',
      title: 'Temple Lesson',
      logline: 'A monk teaches a disciple.',
      durationSec: 8,
      shotCount: 1,
      userPrompt: 'temple lesson',
      screenplayText: null,
    },
    styleBible: {
      strategy: 'style_bible',
      rawUserStyle: 'temple lesson',
      styleSummary: 'Restrained naturalistic temple visual style.',
      stylePolicy: {
        visual: {
          negativePrompt: 'No subtitles.',
          imageFilterPrompt: 'soft natural light',
          lightingPrompt: 'soft daylight',
          colorPrompt: 'muted stone and wood',
          texturePrompt: 'stone, wood, linen',
          compositionPrompt: 'balanced composition',
        },
        camera: {
          movementPrompt: 'locked camera',
          lensAndDepthPrompt: '35mm natural depth',
          videoRhythmPrompt: 'slow rhythm',
        },
        sound: {
          soundFilterPrompt: 'quiet wind',
        },
        hardBans: ['No subtitles.'],
      },
    },
    shots: [{
      shotNumber: 1,
      durationSec: 8,
      visualAction: 'Old monk teaches the young disciple.',
      charactersAndScene: 'Temple courtyard',
      camera: 'medium shot',
      videoPrompt: 'Temple lesson.',
      sound: 'wind',
    }],
    videoBlocks: [{
      kind: 'single',
      shotNumbers: [1],
      reason: 'Fixed courtyard blocking.',
      prompt: 'Temple lesson.',
      blockIndex: 0,
      sourceVideoBlockId: 'edit-1:videoBlock:1',
    }],
    assets: [{
      requirementId: 'loc-1',
      kind: 'location',
      name: '寺院庭院',
      description: '有木门、石阶和香炉的庭院',
      shotNumbers: [1],
      targetId: 'location-1',
      previewImageUrl: 'https://cdn.example.com/temple.png',
      spatialProfile: {
        schemaVersion: 1,
        sceneSummary: '最终场景图是一处寺院庭院，木门在画面左后方，香炉在中景中央。',
        anchors: [{
          id: 'anchor_left_door',
          label: '左侧木门',
          screenArea: '画面左后方',
          depthLayer: '背景',
          spatialRelations: ['木门右侧是石阶', '木门前方有可站空地'],
        }],
        placementZones: [{
          id: 'zone_left_door_inside',
          label: '左侧木门内侧靠墙的位置',
          absolutePosition: '画面左后方靠墙',
          nearAnchors: ['左侧木门'],
          depthLayer: '背景',
          visibility: '适合半身或全身出现',
          spatialRelations: ['位于香炉左后方', '距离石阶较近'],
        }],
        depthLayout: {
          foreground: '前景为空地',
          midground: '中景有香炉',
          background: '背景有木门和石墙',
        },
        lightingDirection: '光线从画面右上方进入',
      },
    }],
  }
}

const cameraPanel = {
  panelIndex: 0,
  sourceShotNumber: 1,
  sourceVideoBlockId: 'edit-1:videoBlock:1',
  shotScale: '中景',
  cameraPosition: '庭院正前方偏右',
  cameraHeight: '视线高度',
  cameraAngle: '平拍',
  composition: '人物位于画面中景中央，左后方木门保持可见',
  cameraMovement: '固定镜头',
  lensAndDepth: '35mm，自然景深',
  screenDirection: '弟子从画面右侧看向左侧师父',
  aestheticIntent: '保持安静克制的教学氛围',
  emotionalEffect: '沉静',
  continuityNote: '持续使用左后方木门和中景香炉作为空间锚点',
  shotBlocking: {
    locationName: '寺院庭院',
    absolutePosition: '人物站在中景香炉前方的空地',
    relativePosition: '老和尚在弟子左侧半步',
    screenPosition: '画面中部偏左',
    characterPlacements: [{
      characterName: '老和尚',
      absolutePosition: '中景香炉前方偏左',
      relativePosition: '弟子左侧半步',
      screenPosition: '画面中部偏左',
      facing: '面向弟子',
      eyeline: '看向弟子眼睛',
    }],
    cameraPlacement: '庭院正前方偏右，面向木门方向',
    composition: '左后方木门作为背景锚点',
    continuityNote: '不使用任何网格坐标',
  },
  finalPanelPrompt: '严格按照中文空间档案和人物站位生成寺院庭院教学分镜画面，保持木门与香炉空间关系。',
}

describe('edit-script storyboard spatial text blocking generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiExecMock.executeAiTextStep
      .mockResolvedValueOnce({
        text: JSON.stringify({
          cameraStyleBible: {
            strategy: 'camera_style_bible',
            imageFilterPrompt: '安静自然光，保持寺院庭院空间真实',
          },
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          panelVisualPlanBlockOutput: {
            sourceVideoBlockId: 'edit-1:videoBlock:1',
            panels: [cameraPanel],
          },
        }),
      })
  })

  it('plans camera blocking from spatial profiles without x/y coordinate inputs', async () => {
    const spatialProfileStrategyOutput = {
      strategy: 'spatial_text_blocking',
      locations: [{
        requirementId: 'loc-1',
        targetId: 'location-1',
        name: '寺院庭院',
        shotNumbers: [1],
        spatialProfile: buildSourceSnapshot().assets[0]?.spatialProfile,
      }],
    }

    const result = await generateStoryboardPanelVisualPlan({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model-1',
      locale: 'zh',
      snapshot: buildSourceSnapshot(),
      spatialProfileStrategyOutput,
    })

    expect(result.cameraPlanOutput.strategy).toBe('spatial_text_blocking')
    expect(result.cameraPlanOutput.panels[0]?.shotBlocking.absolutePosition).toBe('人物站在中景香炉前方的空地')
    expect(result.panels[0]?.metadata).toMatchObject({ source: 'camera_plan', strategy: 'spatial_text_blocking' })
    const promptCalls = promptMock.buildAiPrompt.mock.calls.map((call) => call[0])
    expect(promptCalls[0]?.variables.spatial_profile_strategy_output_json).toContain('左侧木门内侧靠墙的位置')
    expect(promptCalls[1]?.variables.spatial_profile_strategy_output_json).toContain('edit-1:videoBlock:1')
    const deprecatedVariableKey = ['coordinate', 'strategy', 'output', 'json'].join('_')
    expect(promptCalls[0]?.variables).not.toHaveProperty(deprecatedVariableKey)
    expect(JSON.stringify(result)).not.toContain('"x"')
    expect(JSON.stringify(result)).not.toContain('"y"')
  })
})
