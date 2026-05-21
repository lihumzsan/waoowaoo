import type { EditScriptStyleBible } from '@/lib/edit-script/types'

export function buildZenStyleBibleFixture(): EditScriptStyleBible {
  return {
    strategy: 'style_bible',
    rawUserStyle: '禅修短片',
    styleSummary: '禅意电影感，安静、克制、自然。',
    stylePolicy: {
      rawUserStyle: '禅修短片',
      styleSummary: '禅意电影感，安静、克制、自然。',
      visual: {
        positivePrompt: '柔和自然光，低对比度，清澈空气感，淡雅胶片质感。',
        negativePrompt: '避免商业广告感，避免高反差大片感，避免炫技运镜。',
        imageFilterPrompt: '轻微柔焦，35mm镜头，克制高光。',
        lightingPrompt: '清晨漫射光，阴影柔软，不过曝。',
        colorPrompt: '低饱和，自然灰绿、木色、石灰色。',
        texturePrompt: '木纹、石面、薄雾与旧纸感，真实不塑料。',
        compositionPrompt: '留白克制，人物与空间保持安静距离。',
      },
      camera: {
        rhythmPrompt: '缓慢呼吸式节奏，镜头停留足够久。',
        movementPrompt: '静态或极慢推拉，避免炫技运镜。',
        lensAndDepthPrompt: '35mm镜头，中浅景深，自然透视。',
        editingPacingPrompt: '慢剪辑，镜头之间自然过渡。',
      },
      motion: {
        subjectMotionPrompt: '动作轻微、缓慢、像呼吸一样连续。',
        actingPrompt: '表演内收，少表情，重停顿。',
      },
      sound: {
        positivePrompt: '安静环境声，远处风声与木质细响。',
        negativePrompt: '避免史诗配乐、强鼓点、夸张音效。',
        soundFilterPrompt: '低噪、近自然声场、不过度压缩。',
        soundStylePrompt: '极简、留白、细节清晰。',
      },
      hardBans: [
        '禁止商业广告质感',
        '禁止高反差大片感',
        '禁止炫技运镜',
      ],
    },
  }
}
