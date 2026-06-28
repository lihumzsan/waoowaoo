import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aiDesign } from '@/lib/asset-utils/ai-design'
import {
  buildEditAssetDesignInstruction,
  designEditAssetRequirements,
} from '@/lib/edit-script/asset-design'
import type { EditAssetRequirement, EditScriptShot, EditScriptStyleBible } from '@/lib/edit-script/types'

vi.mock('@/lib/asset-utils/ai-design', () => ({
  aiDesign: vi.fn(),
}))

const aiDesignMock = vi.mocked(aiDesign)

const shots: readonly EditScriptShot[] = [
  {
    shotNumber: 1,
    durationSec: 8,
    scene: { name: '环形太空舱中控室' },
    action: '冷静研究员站在环形太空舱中控台前，红色状态灯缓慢闪烁。',
    characters: [
      {
        name: '冷静研究员',
        visibility: 'visible',
        role: 'focus',
        performance: '克制地观察控制台',
      },
    ],
    keyObjects: [
      { name: '环形中控台', role: 'operation_surface' },
    ],
    sound: '低频舱体嗡鸣',
  },
]

const requirements: readonly EditAssetRequirement[] = [
  {
    kind: 'character',
    name: '冷静研究员',
    description: '主要出镜人物，贯穿太空舱镜头。',
    shotNumbers: [1],
    status: 'pending',
    targetId: null,
    errorMessage: null,
  },
  {
    kind: 'location',
    name: '环形太空舱中控室',
    description: '主要场景，研究员在此执行操作。',
    shotNumbers: [1],
    status: 'pending',
    targetId: null,
    errorMessage: null,
  },
]

const styleBible: EditScriptStyleBible = {
  rawUserStyle: '冷峻科幻风格',
  styleSummary: '低饱和银灰色、硬质冷光、干净宽频、克制高光的冷峻科幻质感。',
  stylePolicy: {
    visual: {
      imageFilterPrompt: '低饱和银灰色，硬质冷光，干净未来材质，克制高光',
      lightingPrompt: '硬质冷光，阴影边缘清楚但不过度高反差。',
      colorPrompt: '银灰、冷白和少量红色状态灯。',
      texturePrompt: '拉丝金属、磨砂玻璃和干净制服面料。',
      compositionPrompt: '对称、留白、秩序感强。',
    },
    camera: {
      movementPrompt: '固定镜头和轻微推近。',
      lensAndDepthPrompt: '35mm，自然景深。',
      videoRhythmPrompt: '缓慢、克制，少切换。',
    },
    directing: {
      pointOfViewPrompt: 'restricted protagonist viewpoint',
      performancePrompt: 'restrained performance through small gestures',
      informationReleasePrompt: 'reveal information through reaction before event truth',
      rhythmPrompt: 'hold suspense pauses before faster turns',
    },
    sound: {
      soundFilterPrompt: '干净宽频，低动态，轻微空间混响',
    },
  },
}

describe('edit script asset design', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds a structured asset design instruction from edit table shots', () => {
    const instruction = buildEditAssetDesignInstruction({
      userPrompt: '一分钟冷峻科幻短片',
      styleBible,
      requirement: requirements[0],
      shots,
    })

    const parsed = JSON.parse(instruction) as {
      readonly task: string
      readonly styleBible: EditScriptStyleBible
      readonly asset: { readonly kind: string; readonly name: string; readonly description: string | null }
      readonly linkedShots: ReadonlyArray<Pick<EditScriptShot, 'shotNumber' | 'durationSec' | 'scene' | 'action' | 'characters' | 'keyObjects' | 'sound'>>
      readonly constraints: readonly string[]
    }
    expect(parsed.task).toBe('design_edit_first_required_asset_for_image_generation')
    expect(parsed.styleBible.stylePolicy.visual.imageFilterPrompt).toBe('低饱和银灰色，硬质冷光，干净未来材质，克制高光')
    expect(parsed.asset).toMatchObject({ kind: 'character', name: '冷静研究员' })
    expect(parsed.constraints).toContain('Use styleBible.stylePolicy.visual as the only asset-level visual policy.')
    expect(parsed.constraints).toContain('The asset description must include stable lighting, color palette, material texture, composition, and image-filter traits from the Style Bible that can directly guide image generation.')
    expect(parsed.linkedShots).toEqual([
      expect.objectContaining({
        shotNumber: 1,
        action: '冷静研究员站在环形太空舱中控台前，红色状态灯缓慢闪烁。',
        scene: { name: '环形太空舱中控室' },
        characters: [
          {
            name: '冷静研究员',
            visibility: 'visible',
            role: 'focus',
            performance: '克制地观察控制台',
          },
        ],
        keyObjects: [
          { name: '环形中控台', role: 'operation_surface' },
        ],
        sound: '低频舱体嗡鸣',
      }),
    ])
  })

  it('uses existing character/create and location/create design prompts for final asset descriptions', async () => {
    aiDesignMock
      .mockResolvedValueOnce({
        success: true,
        prompt: '冷静研究员，约三十五岁，短发整齐，穿银灰色极简航天制服，黑色软底工作靴。',
      })
      .mockResolvedValueOnce({
        success: true,
        prompt: '「环形太空舱中控室」广角镜头展示环形墙面、中控台和远处观察窗。',
      })

    const designed = await designEditAssetRequirements({
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      analysisModel: 'analysis-model',
      userPrompt: '一分钟冷峻科幻短片',
      styleBible,
      shots,
      requirements,
    })

    expect(aiDesignMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      assetType: 'character',
      analysisModel: 'analysis-model',
      userInstruction: expect.stringContaining('"kind": "character"'),
    }))
    expect(aiDesignMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      assetType: 'location',
      userInstruction: expect.stringContaining('"name": "环形太空舱中控室"'),
    }))
    expect(designed[0]?.description).toBe('冷静研究员，约三十五岁，短发整齐，穿银灰色极简航天制服，黑色软底工作靴。')
    expect(designed[1]?.description).toContain('「环形太空舱中控室」广角镜头展示环形墙面、中控台和远处观察窗。')
    expect(designed[1]?.description).not.toContain('可站位置：')
  })

  it('fails explicitly when the reused asset design prompt returns no usable prompt', async () => {
    aiDesignMock.mockResolvedValueOnce({
      success: false,
      error: 'AI返回格式错误',
    })

    await expect(designEditAssetRequirements({
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      analysisModel: 'analysis-model',
      userPrompt: '一分钟冷峻科幻短片',
      styleBible,
      shots,
      requirements: [requirements[0]],
    })).rejects.toThrow('EDIT_SCRIPT_ASSET_DESIGN_FAILED:character:冷静研究员:AI返回格式错误')
  })
})
