import {
  CHARACTER_ASSET_IMAGE_RATIO,
  TASK_TYPE,
  aiRuntimeMock,
  beforeEach,
  buildJob,
  describe,
  expect,
  getUpdateData,
  handleAssetHubModifyTask,
  handleModifyAssetImageTask,
  it,
  prismaMock,
  utilsMock,
  vi,
} from './modify-image-description.fixture'

describe('modify image syncs descriptions after edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiRuntimeMock.executeAiTextStep.mockReset()
    aiRuntimeMock.executeAiVisionStep.mockReset()
    utilsMock.uploadImageSourceToCos.mockReset()
    aiRuntimeMock.executeAiTextStep.mockResolvedValue({ text: '{"prompt":"TEXT_UPDATED_DESCRIPTION"}' })
    aiRuntimeMock.executeAiVisionStep.mockResolvedValue({ text: '{"prompt":"VISION_UPDATED_DESCRIPTION"}' })
    utilsMock.uploadImageSourceToCos.mockResolvedValue('cos/new-image.png')

    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      id: 'appearance-1',
      imageUrls: JSON.stringify(['cos/original-image.png', 'cos/original-image-2.png']),
      imageUrl: 'cos/original-image.png',
      selectedIndex: 1,
      changeReason: 'base',
      description: 'old primary description',
      descriptions: JSON.stringify(['old primary description', 'old variant description']),
      character: { name: 'Hero' },
    })

    prismaMock.locationImage.findFirst.mockResolvedValue({
      id: 'location-image-1',
      locationId: 'location-1',
      description: 'old location description',
      imageUrl: 'cos/original-location.png',
      previousDescription: null,
      location: { name: 'Old Town' },
    })

    prismaMock.globalCharacter.findFirst.mockResolvedValue({
      id: 'global-character-1',
      name: 'Hero',
      appearances: [
        {
          id: 'global-appearance-1',
          appearanceIndex: 0,
          changeReason: 'base',
          description: 'global primary description',
          descriptions: JSON.stringify(['global primary description', 'global variant description']),
          imageUrl: 'cos/original-global.png',
          imageUrls: JSON.stringify(['cos/original-global.png', 'cos/original-global-2.png']),
          selectedIndex: 1,
          previousDescription: null,
          previousDescriptions: null,
        },
      ],
    })

    prismaMock.globalLocation.findFirst.mockResolvedValue({
      id: 'global-location-1',
      name: 'Old Town',
      images: [
        {
          id: 'global-location-image-1',
          imageIndex: 0,
          description: 'global location description',
          imageUrl: 'cos/original-global-location.png',
          previousDescription: null,
        },
      ],
    })
  })

  it('syncs project character descriptions for pure text edits', async () => {
    const job = buildJob(TASK_TYPE.MODIFY_ASSET_IMAGE, {
      type: 'character',
      appearanceId: 'appearance-1',
      imageIndex: 1,
      modifyPrompt: '给角色增加更复杂的甲胄细节',
    })

    await handleModifyAssetImageTask(job)

    expect(aiRuntimeMock.executeAiTextStep).toHaveBeenCalledTimes(1)
    expect(aiRuntimeMock.executeAiVisionStep).not.toHaveBeenCalled()

    const characterUpdateCall = prismaMock.characterAppearance.update.mock.calls.at(-1) as [unknown] | undefined
    const updateArg = characterUpdateCall?.[0]
    const updateData = getUpdateData(updateArg)
    expect(updateData.previousDescription).toBe('old primary description')
    expect(updateData.previousDescriptions).toBe(JSON.stringify(['old primary description', 'old variant description']))
    expect(updateData.description).toBe('old primary description')
    expect(updateData.descriptions).toBe(JSON.stringify(['old primary description', 'TEXT_UPDATED_DESCRIPTION']))
    expect(updateData.imageUrl).toBe('cos/new-image.png')
  })

  it('syncs asset-hub character descriptions for reference-image edits and preserves sibling variants', async () => {
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce('cos/new-global-image.png')

    const job = buildJob(TASK_TYPE.ASSET_HUB_MODIFY, {
      type: 'character',
      id: 'global-character-1',
      appearanceIndex: 0,
      imageIndex: 1,
      modifyPrompt: '把服装改成更锐利的深色铠甲',
      extraImageUrls: ['https://ref.example/b.png'],
    })

    await handleAssetHubModifyTask(job)

    expect(aiRuntimeMock.executeAiVisionStep).toHaveBeenCalledTimes(1)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          referenceImages: ['https://signed/current-image.png', 'https://ref.example/b.png'],
          aspectRatio: CHARACTER_ASSET_IMAGE_RATIO,
        }),
      }),
    )

    const globalCharacterUpdateCall = prismaMock.globalCharacterAppearance.update.mock.calls.at(-1) as [unknown] | undefined
    const updateArg = globalCharacterUpdateCall?.[0]
    const updateData = getUpdateData(updateArg)
    expect(updateData.previousDescription).toBe('global primary description')
    expect(updateData.previousDescriptions).toBe(JSON.stringify(['global primary description', 'global variant description']))
    expect(updateData.description).toBe('global primary description')
    expect(updateData.descriptions).toBe(JSON.stringify(['global primary description', 'VISION_UPDATED_DESCRIPTION']))
    expect(updateData.imageUrl).toBe('cos/new-global-image.png')
    expect(updateData.imageUrls).toBe(JSON.stringify(['cos/original-global.png', 'cos/new-global-image.png']))
  })
})
