import { randomUUID } from 'node:crypto'
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
  const editScreenplay = await prisma.projectEditScreenplay.create({
    data: {
      projectId: project.id,
      episodeId: episode.id,
      userPrompt: 'seed prompt',
      screenplayText: 'seed screenplay',
      status: 'ready',
    },
  })

  const editScript = await prisma.projectEditScript.create({
    data: {
      projectId: project.id,
      episodeId: episode.id,
      editScreenplayId: editScreenplay.id,
      corePlanJson: {
        shots: [
          {
            shotNumber: 1,
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
            shotNumbers: [1],
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
      editScriptId: editScript.id,
      panelCount: 1,
    },
  })

  const panel = await prisma.projectPanel.create({
    data: {
      storyboardId: storyboard.id,
      panelIndex: 0,
      panelNumber: 1,
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
