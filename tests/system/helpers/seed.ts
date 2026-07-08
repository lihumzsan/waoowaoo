import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '../../helpers/prisma'
import {
  createFixtureEpisode,
  createFixtureNovelProject,
  createFixtureProject,
  createFixtureUser,
} from '../../helpers/fixtures'

function nextSuffix() {
  return randomUUID().slice(0, 8)
}

export async function seedMinimalDomainState() {
  const user = await createFixtureUser()
  const project = await createFixtureProject(user.id)
  const novelProject = await createFixtureNovelProject(project.id)
  const episode = await createFixtureEpisode(novelProject.id)
  const sourceText = 'seed bible'
  const checksum = createHash('sha256').update(sourceText).digest('hex')
  const sourceDocument = await prisma.projectEpisodeSourceDocument.create({
    data: {
      episodeId: episode.id,
      normalizedText: sourceText,
      checksum,
      sourceKind: 'paste',
      version: 1,
    },
  })
  const editBible = await prisma.projectEditBible.create({
    data: {
      episodeId: episode.id,
      sourceDocumentId: sourceDocument.id,
      bibleJson: {
        synopsis: sourceText,
        characters: [],
        locations: [],
        worldRules: [],
        styleGuide: {},
      },
      beatSheetJson: { beats: [] },
      ledgerJson: { events: [] },
      emotionalCurveJson: { cues: [] },
      status: 'confirmed',
      lockedAt: new Date(),
    },
  })
  const chapter = await prisma.projectEditChapter.create({
    data: {
      episodeId: episode.id,
      chapterIndex: 0,
      title: 'Seed chapter',
      summary: sourceText,
      sourceDocumentId: sourceDocument.id,
      sourceStart: 0,
      sourceEnd: sourceText.length,
      targetDurationSec: 30,
      provenanceJson: {
        sourceDocumentId: sourceDocument.id,
        bibleVersion: editBible.version,
        beatIds: [],
        eventIds: [],
      },
    },
  })

  const editScript = await prisma.projectEditScript.create({
    data: {
      projectId: project.id,
      episodeId: episode.id,
      chapterId: chapter.id,
      corePlanJson: {
        shots: [
          {
            shotId: 'shot-1',
            shotNumber: 1,
            shotPurpose: 'action',
            durationSec: 3,
            scene: { name: 'Office' },
            action: 'seed panel',
            characters: [
              {
                name: 'Narrator',
                visibility: 'visible',
                role: 'focus',
                performance: 'stands in the office',
              },
            ],
            keyObjects: [],
            sound: 'room tone',
          },
        ],
        generationSegments: [
          {
            shotIds: ['shot-1'],
            continuity: 'seed panel continuity',
          },
        ],
      },
      durationSec: 30,
      shotCount: 1,
    },
  })

  const storyboard = await prisma.projectStoryboard.create({
    data: {
      episodeId: episode.id,
      chapterId: chapter.id,
      editScriptId: editScript.id,
      panelCount: 1,
    },
  })

  const panel = await prisma.projectPanel.create({
    data: {
      storyboardId: storyboard.id,
      panelIndex: 0,
      panelNumber: 1,
      sourceShotId: 'shot-1',
      shotType: '中景',
      cameraMove: '固定',
      description: 'seed panel',
      location: 'Office',
      characters: JSON.stringify(['Narrator']),
      imageUrl: 'https://provider.example/panel.jpg',
    },
  })

  const character = await prisma.projectCharacter.create({
    data: {
      projectId: project.id,
      name: 'Narrator',
    },
  })

  const appearance = await prisma.characterAppearance.create({
    data: {
      characterId: character.id,
      appearanceIndex: 0,
      changeReason: 'default',
      description: 'Narrator appearance',
      imageUrls: JSON.stringify(['images/character-seed.jpg']),
      imageUrl: 'images/character-seed.jpg',
      selectedIndex: 0,
    },
  })

  const location = await prisma.projectLocation.create({
    data: {
      projectId: project.id,
      name: 'Office',
      summary: 'Office summary',
    },
  })

  const locationImage = await prisma.locationImage.create({
    data: {
      locationId: location.id,
      imageIndex: 0,
      description: 'Office image',
      imageUrl: 'images/location-seed.jpg',
      isSelected: true,
    },
  })

  const secondaryPanel = await prisma.projectPanel.create({
    data: {
      storyboardId: storyboard.id,
      panelIndex: 1,
      panelNumber: 2,
      sourceShotId: 'shot-2',
      shotType: '近景',
      cameraMove: '推镜',
      description: 'secondary panel',
      location: 'Office',
      characters: JSON.stringify(['Narrator']),
    },
  })

  await prisma.projectStoryboard.update({
    where: { id: storyboard.id },
    data: { panelCount: 2 },
  })

  const foreignStoryboard = await prisma.projectStoryboard.create({
    data: {
      episodeId: episode.id,
      chapterId: chapter.id,
      panelCount: 1,
    },
  })

  const foreignPanel = await prisma.projectPanel.create({
    data: {
      id: `panel-foreign-${nextSuffix()}`,
      storyboardId: foreignStoryboard.id,
      panelIndex: 0,
      panelNumber: 1,
      shotType: '远景',
      cameraMove: '固定',
      description: 'foreign panel',
      location: 'Office',
      characters: JSON.stringify(['Narrator']),
    },
  })

  return {
    user,
    project,
    novelProject,
    episode,
    editScript,
    storyboard,
    panel,
    secondaryPanel,
    foreignStoryboard,
    foreignPanel,
    character,
    appearance,
    location,
    locationImage,
  }
}
