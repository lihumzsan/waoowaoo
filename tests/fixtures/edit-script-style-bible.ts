import type { EditScriptStyleBible } from '@/lib/edit-script/types'

export function buildZenStyleBibleFixture(): EditScriptStyleBible {
  return {
    rawUserStyle: '禅修短片',
    styleSummary: '禅意电影感，安静、克制、自然。',
    visualStyle: '低饱和自然灰绿与木色，轻微柔焦，克制高光，真实材质。',
    assetImageStyle: {
      lighting: '清晨漫射光，阴影柔软，不过曝。',
      texture: '木纹、石面、薄雾与旧纸感，真实不塑料。',
      composition: '留白克制，人物与空间保持安静距离。',
    },
  }
}
