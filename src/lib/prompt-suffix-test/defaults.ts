import type { Locale } from '@/i18n/routing'

export const DEFAULT_PROMPT_LENGTH_TEST_STORYBOARD_JSON: Record<Locale, string> = {
  zh: JSON.stringify({
    panel: {
      panel_id: 'panel_xxx',
      shot_type: '中景',
      camera_move: '平视固定镜头',
      description: '年轻僧人走到桌前，看到桌上的信。',
      image_prompt: '单张电影分镜图，写实东方自然主义，16:9画幅。柔和右侧窗光落在矮桌、信纸和年轻僧人的衣料上，画面低饱和、低对比度，木纹、纸张和布料保持真实触感，空气感轻微。年轻僧人已经走到茶室中景偏右的矮桌前方，低头看见桌上的一封信，动作很慢，神情安静。中景，平视，35mm，轻微自然浅景深；前景是木地板边缘，中景为人物、矮桌和信纸，背景保留左后方木门和右侧窗光。构图留白克制，不新增任何道具或人物。禁止文字，禁止字幕，禁止编号，禁止水印，禁止logo。',
      video_prompt: '年轻僧人从门口走向矮桌前方，脚步缓慢，视线落在桌面信纸上。镜头轻微推近，保持茶室空间稳定。',
      location: '茶室',
      characters: [{ name: '年轻僧人', appearance: '主造型' }],
      source_text: '年轻僧人走到桌前，发现师父留下的一封信。',
      photography_rules: {
        source: 'edit_script',
        consistencyMode: 'spatial_text_blocking',
        consistencyMetadata: {
          cameraPlan: {
            shotScale: '中景',
            cameraPosition: '茶室中线偏左，朝向矮桌前方',
            cameraHeight: '平视',
            cameraAngle: '平拍',
            composition: '年轻僧人位于中景偏右，矮桌和信纸在他前方，木门保持在左后方背景',
            lensAndDepth: '35mm，自然浅景深',
            shotBlocking: {
              locationName: '茶室',
              absolutePosition: '年轻僧人站在矮桌前方位置',
              relativePosition: '人物靠近中景偏右的矮桌，木门在他左后方',
              screenPosition: '画面中部偏右',
              characterPlacements: [{
                characterName: '年轻僧人',
                absolutePosition: '矮桌前方',
                relativePosition: '位于矮桌前方，木门在左后方',
                screenPosition: '画面中部偏右',
                facing: '面向桌面',
                eyeline: '看向桌面信纸',
              }],
              cameraPlacement: '机位在茶室中线偏左，平视拍向人物和桌面',
              composition: '人物、矮桌、信纸构成中景视觉中心',
              continuityNote: '保持木门在左后方、矮桌在中景偏右',
            },
          },
        },
      },
      shot_blocking: {
        locationName: '茶室',
        absolutePosition: '年轻僧人站在矮桌前方位置',
        relativePosition: '人物靠近中景偏右的矮桌，木门在他左后方',
        screenPosition: '画面中部偏右',
        cameraPlacement: '机位在茶室中线偏左，平视拍向人物和桌面',
        composition: '人物、矮桌、信纸构成中景视觉中心',
      },
    },
    context: {
      character_appearances: [{
        name: '年轻僧人',
        description: '角色资产里的外貌描述、服装、年龄、体型等',
      }],
      location_reference: {
        name: '茶室',
        description: '场景资产描述',
        spatial_profile: {
          sceneSummary: '茶室内有左后方木门、中景偏右矮桌、右侧窗户，光线从右侧进入。',
          anchors: [
            {
              label: '左后方木门',
              screenArea: '画面左后方',
              depthLayer: '背景',
              spatialRelations: ['木门右侧是室内空间', '木门与矮桌形成左后到中景的关系'],
            },
            {
              label: '中景矮桌',
              screenArea: '画面中景偏右',
              depthLayer: '中景',
              spatialRelations: ['矮桌在人物前方', '矮桌后方能看到墙面和窗光'],
            },
            {
              label: '右侧窗户',
              screenArea: '画面右侧背景',
              depthLayer: '背景',
              spatialRelations: ['光线从右侧窗户进入', '窗光照到矮桌和人物侧面'],
            },
          ],
          depthLayout: {
            foreground: '木地板和少量留白',
            midground: '矮桌和人物活动区域',
            background: '木门、墙面、窗户',
          },
          lightingDirection: '柔和自然光从画面右侧进入',
        },
      },
      reference_images: [
        { image_no: '图 1', role: 'character', name: '年轻僧人' },
        { image_no: '图 2', role: 'location', name: '茶室' },
      ],
      additional_reference_images: [],
    },
  }, null, 2),
  en: JSON.stringify({
    panel: {
      panel_id: 'panel_xxx',
      shot_type: 'medium shot',
      camera_move: 'eye-level locked shot',
      description: 'A young monk walks to the table and sees the letter on it.',
      image_prompt: 'Single cinematic storyboard image, realistic Eastern naturalism, 16:9. Soft right-side window light falls on the low table, letter paper, and young monk robe. Low saturation, low contrast, realistic wood, paper, and cloth texture, slight airiness. The young monk stands in front of the low table in the midground-right area of the tea room, looking down at a letter on the table. Medium shot, eye-level, 35mm, natural shallow depth. Foreground wood floor edge, midground character, low table and letter, background left-rear wooden door and right window light. Restrained negative space. No extra props or characters. No text, subtitles, numbers, watermark, or logo.',
      video_prompt: 'The young monk slowly walks from the doorway to the front of the low table, his gaze falling onto the letter. The camera pushes in slightly while keeping the tea room space stable.',
      location: 'Tea room',
      characters: [{ name: 'Young monk', appearance: 'Main look' }],
      source_text: 'The young monk walks to the table and discovers a letter left by his master.',
      photography_rules: {
        source: 'edit_script',
        consistencyMode: 'spatial_text_blocking',
        consistencyMetadata: {
          cameraPlan: {
            shotScale: 'medium shot',
            cameraPosition: 'slightly left of the tea room centerline, facing the front of the low table',
            cameraHeight: 'eye-level',
            cameraAngle: 'straight-on',
            composition: 'Young monk in midground-right, low table and letter in front of him, wooden door in left-rear background',
            lensAndDepth: '35mm, natural shallow depth of field',
            shotBlocking: {
              locationName: 'Tea room',
              absolutePosition: 'Young monk stands in front of the low table',
              relativePosition: 'The character is near the midground-right low table, with the wooden door behind and left of him',
              screenPosition: 'middle-right of the frame',
              characterPlacements: [{
                characterName: 'Young monk',
                absolutePosition: 'in front of the low table',
                relativePosition: 'in front of the low table, wooden door left-rear',
                screenPosition: 'middle-right of the frame',
                facing: 'toward the tabletop',
                eyeline: 'toward the letter on the table',
              }],
              cameraPlacement: 'camera slightly left of the tea room centerline, eye-level, facing the character and tabletop',
              composition: 'character, low table, and letter form the midground visual center',
              continuityNote: 'keep wooden door left-rear and low table midground-right',
            },
          },
        },
      },
      shot_blocking: {
        locationName: 'Tea room',
        absolutePosition: 'Young monk stands in front of the low table',
        relativePosition: 'The character is near the midground-right low table, with the wooden door behind and left of him',
        screenPosition: 'middle-right of the frame',
        cameraPlacement: 'camera slightly left of the tea room centerline, eye-level, facing the character and tabletop',
        composition: 'character, low table, and letter form the midground visual center',
      },
    },
    context: {
      character_appearances: [{
        name: 'Young monk',
        description: 'Appearance, clothing, age, and body type from the character asset.',
      }],
      location_reference: {
        name: 'Tea room',
        description: 'Location asset description',
        spatial_profile: {
          sceneSummary: 'The tea room has a left-rear wooden door, a midground-right low table, and a right-side window. Light enters from the right.',
          anchors: [
            {
              label: 'left-rear wooden door',
              screenArea: 'left rear of the frame',
              depthLayer: 'background',
              spatialRelations: ['indoor space is to the right of the door', 'door and table form a left-rear to midground relation'],
            },
            {
              label: 'midground low table',
              screenArea: 'midground-right of the frame',
              depthLayer: 'midground',
              spatialRelations: ['the table is in front of the character', 'wall and window light are visible behind the table'],
            },
            {
              label: 'right-side window',
              screenArea: 'right background',
              depthLayer: 'background',
              spatialRelations: ['light enters from the window', 'window light falls on the table and character side'],
            },
          ],
          depthLayout: {
            foreground: 'wood floor and restrained empty space',
            midground: 'low table and character activity area',
            background: 'wooden door, wall, and window',
          },
          lightingDirection: 'soft natural light enters from the right side of the frame',
        },
      },
      reference_images: [
        { image_no: 'Image 1', role: 'character', name: 'Young monk' },
        { image_no: 'Image 2', role: 'location', name: 'Tea room' },
      ],
      additional_reference_images: [],
    },
  }, null, 2),
}

export const DEFAULT_PROMPT_LENGTH_TEST_SOURCE_TEXT: Record<Locale, string> = {
  zh: '年轻僧人走到桌前，发现师父留下的一封信。',
  en: 'The young monk walks to the table and discovers a letter left by his master.',
}

export const DEFAULT_PROMPT_LENGTH_TEST_STYLE_TEXT: Record<Locale, string> = {
  zh: '写实东方自然主义，低饱和，自然光，克制高光。',
  en: 'Realistic Eastern naturalism, low saturation, natural light, restrained highlights.',
}

export const DEFAULT_PROMPT_LENGTH_TEST_STYLE_BIBLE_TEXT: Record<Locale, string> = {
  zh: [
    '系统 Style Bible 视觉要求（固定追加，必须遵守）：',
    '用途：分镜图生成',
    '画面滤镜：柔和自然光，低对比度，轻微空气感，真实材质，克制高光。',
    '光照：自然侧光，柔和阴影。',
    '色彩：低饱和灰绿、浅木色、暖灰。',
    '材质：木、纸、布料、墙面保持真实触感。',
    '构图：留白克制，稳定构图。',
    '镜头与景深：35mm/50mm，自然景深。',
    '负向约束：不要字幕、水印、logo，不要商业广告感，不要高反差大片感。',
  ].join('\n'),
  en: [
    'System Style Bible requirements, fixed append, must follow:',
    'Usage: storyboard image generation.',
    'Image filter: soft natural light, low contrast, slight airiness, realistic materials, restrained highlights.',
    'Lighting: natural side light, soft shadows.',
    'Color: low-saturation gray-green, pale wood, warm gray.',
    'Materials: wood, paper, cloth, and wall surfaces keep realistic tactile texture.',
    'Composition: restrained negative space, stable composition.',
    'Lens and depth: 35mm/50mm, natural depth of field.',
    'Negative constraints: no subtitles, watermark, logo, commercial ad look, or high-contrast blockbuster look.',
  ].join('\n'),
}
