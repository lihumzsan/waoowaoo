import { describe, expect, it } from 'vitest'
import {
  buildCoordinateAnalysisPrompt,
  buildCoordinateCameraGenerationPrompt,
  buildCoordinateFloorPlanPrompt,
  buildCoordinateThreeViewPrompt,
} from '@/lib/coordinate-placement-test/prompt'
import {
  coordinatePlacementAnalyzeRequestSchema,
  coordinatePlacementGenerateRequestSchema,
} from '@/lib/coordinate-placement-test/types'

describe('coordinate placement test prompt', () => {
  it('builds separate prompts for 2D floor plan and three-view references', () => {
    const request = {
      sceneImage: 'data:image/png;base64,AAAA',
      userPrompt: 'A small room with a door and table.',
      imageModelKey: 'image-model-1',
    }

    expect(buildCoordinateFloorPlanPrompt(request, 'en')).toContain('one clean 2D top-down floor plan')
    expect(buildCoordinateFloorPlanPrompt(request, 'en')).toContain('no grid, no coordinates')
    expect(buildCoordinateThreeViewPrompt(request, 'en')).toContain('All three views must be contained in a single image')
    expect(buildCoordinateThreeViewPrompt(request, 'en')).toContain('front view, side view, and rear view')
  })

  it('asks the LLM to output 5 to 10 continuous camera placements as strict JSON', () => {
    const parsed = coordinatePlacementAnalyzeRequestSchema.parse({
      coordinateReferenceImage: 'data:image/png;base64,AAAA',
      referenceMode: 'overlay',
      llmModelKey: 'llm-model-1',
      grid: { columns: 16, rows: 9 },
    })

    const prompt = buildCoordinateAnalysisPrompt(parsed, 'en')

    expect(prompt).toContain('16 X columns and 9 Y rows')
    expect(prompt).toContain('Coordinate (1,1) is the top-left cell')
    expect(prompt).toContain('plan 5 to 10 continuous shots')
    expect(prompt).toContain('"shots":[{"shotNumber":number')
    expect(prompt).toContain('"person":{"x":number,"y":number}')
    expect(prompt).toContain('"camera":{"x":number,"y":number}')
    expect(prompt).toContain('cameraFacing must be one of')
    expect(prompt).toContain('No extra user prompt')
  })

  it('builds the final image prompt from camera marker semantics and strips overlays from output', () => {
    const parsed = coordinatePlacementGenerateRequestSchema.parse({
      cameraReferenceImage: 'data:image/png;base64,AAAA',
      threeViewReferenceImage: 'data:image/png;base64,CCCC',
      characterImage: 'data:image/png;base64,BBBB',
      userPrompt: '把人物放在桌子旁边。',
      imageModelKey: 'image-model-1',
      promptVariant: 'camera_ray_cast',
      grid: { columns: 16, rows: 9 },
      analysis: {
        shotNumber: 1,
        shotLabel: '入口建立',
        person: { x: 7, y: 4 },
        camera: { x: 3, y: 8 },
        cameraFacing: 'north',
        shotIntent: '从房间后方看向桌子。',
      },
    })

    const prompt = buildCoordinateCameraGenerationPrompt(parsed, 'zh')

    expect(prompt).toContain('它不是最终画面背景')
    expect(prompt).toContain('参考图 2 是三视图场景参考')
    expect(prompt).toContain('参考图 3 是人物外观参考')
    expect(prompt).toContain('当前镜头：第 1 镜，入口建立')
    expect(prompt).toContain('人物目标位置：网格坐标 (7, 4)')
    expect(prompt).toContain('摄影机位置：网格坐标 (3, 8)，镜头朝向 north')
    expect(prompt).toContain('最终画面必须像真实摄影机从该位置拍摄出来')
    expect(prompt).toContain('输出图中不得出现摄影机图标、箭头、网格线')
    expect(prompt).toContain('把人物放在桌子旁边。')
  })

  it('builds a strict no-map final prompt variant', () => {
    const parsed = coordinatePlacementGenerateRequestSchema.parse({
      cameraReferenceImage: 'data:image/png;base64,AAAA',
      threeViewReferenceImage: 'data:image/png;base64,CCCC',
      characterImage: 'data:image/png;base64,BBBB',
      userPrompt: 'Place the person in the room.',
      imageModelKey: 'image-model-1',
      promptVariant: 'strict_not_map',
      grid: { columns: 16, rows: 9 },
      analysis: {
        shotNumber: 1,
        shotLabel: 'Door view',
        person: { x: 7, y: 4 },
        camera: { x: 3, y: 8 },
        cameraFacing: 'north',
        shotIntent: 'Door view.',
      },
    })

    const prompt = buildCoordinateCameraGenerationPrompt(parsed, 'en')

    expect(prompt).toContain('Hard constraint')
    expect(prompt).toContain('do not output a top-down view')
    expect(prompt).toContain('ground-level or eye-level perspective')
  })

  it('rejects camera coordinates outside the selected grid', () => {
    const parsed = coordinatePlacementGenerateRequestSchema.safeParse({
      cameraReferenceImage: 'data:image/png;base64,AAAA',
      threeViewReferenceImage: 'data:image/png;base64,CCCC',
      characterImage: 'data:image/png;base64,BBBB',
      userPrompt: 'Place the person near the table.',
      imageModelKey: 'image-model-1',
      promptVariant: 'camera_ray_cast',
      grid: { columns: 12, rows: 8 },
      analysis: {
        shotNumber: 1,
        shotLabel: 'Door view',
        person: { x: 7, y: 4 },
        camera: { x: 13, y: 4 },
        cameraFacing: 'north',
        shotIntent: 'Door view.',
      },
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['analysis', 'camera', 'x'])
      expect(parsed.error.issues[0]?.message).toBe('camera x must be inside grid columns')
    }
  })
})
