import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateStoryboardPanelFinalPrompts } from '@/lib/edit-script/storyboard-consistency/model-generation'
import type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'

const promptMock = vi.hoisted(() => ({
  buildAiPromptContent: vi.fn((input: { promptId: string; variables: Record<string, string> }) => JSON.stringify(input)),
}))

const aiExecMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

vi.mock('@/lib/ai-prompts', () => ({
  AI_PROMPT_IDS: {
    EDIT_SCRIPT_STORYBOARD_CAMERA_STYLE_BIBLE: 'storyboard-camera-style-bible',
    EDIT_SCRIPT_STORYBOARD_PANEL_FINAL_PROMPT_BLOCK: 'storyboard-panel-final-prompt-block',
  },
  buildAiPromptContent: promptMock.buildAiPromptContent,
}))

vi.mock('@/lib/ai-exec/engine', () => aiExecMock)

function buildSourceSnapshot(): StoryboardConsistencySourceSnapshot {
  return {
    projectId: 'project-1',
    episodeId: 'episode-1',
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
      rawUserStyle: 'temple lesson',
      styleSummary: 'Restrained naturalistic temple visual style.',
      stylePolicy: {
        visual: {
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
        directing: {
          pointOfViewPrompt: 'restricted protagonist viewpoint',
          performancePrompt: 'restrained performance through small gestures',
          informationReleasePrompt: 'reveal information through reaction before event truth',
          rhythmPrompt: 'hold suspense pauses before faster turns',
        },
        sound: {
          soundFilterPrompt: 'quiet wind',
        },
      },
    },
    shots: [{
      shotNumber: 1,
      durationSec: 8,
      dramaticPurpose: 'test dramatic purpose',
      visibleAction: 'Old monk teaches the young disciple.',
      audienceFocus: 'test audience focus',
      viewpoint: 'test viewpoint',
      revealPlan: 'test reveal plan',
      performanceBeat: 'test performance beat',
      continuityIn: 'test continuity in',
      continuityOut: 'test continuity out',
      charactersAndScene: 'Temple courtyard',
      sound: 'wind',
    }],
    directorDecoupage: {
      shots: [{
        shotNumber: 1,
        durationSec: 8,
        dramaticPurpose: 'test dramatic purpose',
        visibleAction: 'Old monk teaches the young disciple.',
        audienceFocus: 'test audience focus',
        viewpoint: 'test viewpoint',
        revealPlan: 'test reveal plan',
        performanceBeat: 'test performance beat',
        continuityIn: 'test continuity in',
        continuityOut: 'test continuity out',
        charactersAndScene: 'Temple courtyard',
        sound: 'wind',
      }],
    },
    cinematographyShotPlan: {
      shots: [{
        shotNumber: 1,
        shotScale: 'medium shot',
        lens: '35mm',
        depthOfField: 'moderate depth',
        cameraPosition: 'front of courtyard',
        cameraHeight: 'eye level',
        cameraAngle: 'neutral',
        movement: 'static',
        composition: 'balanced two-person frame',
        lighting: 'soft natural light',
        axisAndEyeline: 'monk left, disciple right',
        continuityIn: 'test continuity in',
        continuityOut: 'test continuity out',
      }],
    },
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
          spatialRelations: ['木门右侧是石阶', '木门位于香炉左后方'],
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
  shotBlocking: {
    locationName: '寺院庭院',
    absolutePosition: '老和尚和弟子位于香炉前方的中景空地',
    relativePosition: '老和尚站在弟子左侧，香炉在两人后方中线',
    screenPosition: '老和尚在画面左三分之一，弟子在画面右三分之一',
    characterPlacements: [{
      characterName: 'Old monk',
      absolutePosition: '香炉前方的中景空地左侧',
      relativePosition: '位于弟子左侧，靠近左侧木门方向',
      screenPosition: '画面左三分之一',
      facing: '朝向画面右侧的弟子',
      eyeline: '看向弟子',
    }],
    cameraPlacement: 'front of courtyard',
    composition: 'balanced two-person frame',
    continuityNote: '保持老和尚左、弟子右的视线轴线',
  },
  finalPanelPrompt: '严格按照中文空间档案和人物站位生成寺院庭院教学分镜画面，保持木门与香炉空间关系，使用中景静态构图。',
  finalVideoPrompt: '生成八秒寺院庭院教学视频，固定镜头，老和尚克制地教导年轻弟子，保留风声和空间连续性。',
}

describe('edit-script storyboard spatial text blocking generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiExecMock.executeAiTextStep
      .mockResolvedValueOnce({
        text: JSON.stringify({
          panelFinalPromptBlockOutput: {
            sourceVideoBlockId: 'edit-1:videoBlock:1',
            panels: [cameraPanel],
          },
        }),
      })
  })

  it('plans camera blocking from spatial profiles without x/y coordinate inputs', async () => {
    const spatialProfileOutput = {
      locations: [{
        requirementId: 'loc-1',
        targetId: 'location-1',
        name: '寺院庭院',
        shotNumbers: [1],
        spatialProfile: buildSourceSnapshot().assets[0]?.spatialProfile,
      }],
    }

    const result = await generateStoryboardPanelFinalPrompts({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model-1',
      locale: 'zh',
      snapshot: buildSourceSnapshot(),
      spatialProfileOutput,
    })

    expect(result.cameraPlanOutput.panels[0]?.cameraPosition).toBe('front of courtyard')
    expect(result.cameraPlanOutput.panels[0]?.shotBlocking).toMatchObject({
      absolutePosition: '老和尚和弟子位于香炉前方的中景空地',
      relativePosition: '老和尚站在弟子左侧，香炉在两人后方中线',
      screenPosition: '老和尚在画面左三分之一，弟子在画面右三分之一',
    })
    expect(result.panels[0]?.shotBlocking).toMatchObject(cameraPanel.shotBlocking)
    expect(result.panels[0]?.metadata).toMatchObject({
      source: 'camera_plan',
      cameraPlan: {
        shotBlocking: cameraPanel.shotBlocking,
      },
    })
    const promptCalls = promptMock.buildAiPromptContent.mock.calls.map((call) => call[0])
    expect(promptCalls[0]?.variables.spatial_profile_output_json).toContain('左侧木门')
    expect(promptCalls[0]?.variables.spatial_profile_output_json).not.toContain('placementZones')
    expect(promptCalls[0]?.variables.video_block_json).toContain('edit-1:videoBlock:1')
    const deprecatedVariableKey = ['coordinate', 'strategy', 'output', 'json'].join('_')
    expect(promptCalls[0]?.variables).not.toHaveProperty(deprecatedVariableKey)
    expect(JSON.stringify(result)).not.toContain('"x"')
    expect(JSON.stringify(result)).not.toContain('"y"')
  })
})
