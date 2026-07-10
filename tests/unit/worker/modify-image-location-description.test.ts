import {
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

  it('syncs project location descriptions for pure text edits', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({ text: '{"prompt":"TEXT_UPDATED_LOCATION"}' })

    const job = buildJob(TASK_TYPE.MODIFY_ASSET_IMAGE, {
      type: 'location',
      locationId: 'location-1',
      imageIndex: 0,
      modifyPrompt: '增加更浓的晨雾和老城石墙细节',
    })

    await handleModifyAssetImageTask(job)

    const locationUpdateCall = prismaMock.locationImage.update.mock.calls.at(-1) as [unknown] | undefined
    const updateArg = locationUpdateCall?.[0]
    const updateData = getUpdateData(updateArg)
    expect(updateData.previousDescription).toBe('old location description')
    expect(updateData.description).toBe('TEXT_UPDATED_LOCATION')
    expect(updateData.imageUrl).toBe('cos/new-image.png')
    expect(updateData.spatialProfileStatus).toBe('stale')
    expect(updateData.spatialProfileError).toBeNull()
  })

  it('syncs asset-hub location descriptions for reference-image edits', async () => {
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce('cos/new-global-location-image.png')
    aiRuntimeMock.executeAiVisionStep.mockResolvedValueOnce({ text: '{"prompt":"VISION_UPDATED_LOCATION"}' })

    const job = buildJob(TASK_TYPE.ASSET_HUB_MODIFY, {
      type: 'location',
      id: 'global-location-1',
      imageIndex: 0,
      modifyPrompt: '改成潮湿阴冷的石砌街道',
      extraImageUrls: ['https://ref.example/location.png'],
    })

    await handleAssetHubModifyTask(job)

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          referenceImages: ['https://signed/current-image.png', 'https://ref.example/location.png'],
        }),
      }),
    )

    const globalLocationUpdateCall = prismaMock.globalLocationImage.update.mock.calls.at(-1) as [unknown] | undefined
    const updateArg = globalLocationUpdateCall?.[0]
    const updateData = getUpdateData(updateArg)
    expect(updateData.previousDescription).toBe('global location description')
    expect(updateData.description).toBe('VISION_UPDATED_LOCATION')
    expect(updateData.imageUrl).toBe('cos/new-global-location-image.png')
    expect(updateData.spatialProfileStatus).toBe('stale')
    expect(updateData.spatialProfileError).toBeNull()
  })
})
