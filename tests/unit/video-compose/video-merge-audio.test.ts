import { describe, expect, it } from 'vitest'
import { muxVideoMergeAudio } from '@/lib/video-compose/video-merge-audio'

const loudnormStderrWithComfyUiPromptMetadata = [
  'Input #0, mp3, from sound-effect.mp3:',
  '  Metadata:',
  '    prompt          : {"28":{"class_type":"SaveAudioMP3"},"29":{"inputs":{"manual_model_path":""',
  '    encoder         : Lavf62.3.100',
  '  Duration: 00:00:15.02, start: 0.023021, bitrate: 185 kb/s',
  '[Parsed_loudnorm_0 @ 000001dc62538cc0]',
  '{',
  '  "input_i" : "-49.51",',
  '  "input_tp" : "-22.51",',
  '  "input_lra" : "0.30",',
  '  "input_thresh" : "-59.51",',
  '  "output_i" : "-18.01",',
  '  "output_tp" : "-1.50",',
  '  "output_lra" : "5.30",',
  '  "output_thresh" : "-28.01",',
  '  "normalization_type" : "dynamic",',
  '  "target_offset" : "12.01"',
  '}',
].join('\n')

describe('video merge loudness analysis', () => {
  it('ignores JSON-shaped input metadata before the loudnorm measurement', async () => {
    const result = await muxVideoMergeAudio({
      runCommand: async (_command, args) => ({
        stdout: '',
        stderr: args.some((arg) => arg.includes('print_format=json'))
          ? loudnormStderrWithComfyUiPromptMetadata
          : '',
      }),
      stitchedPath: 'stitched.mp4',
      mainAudioPath: 'main-audio.wav',
      hasSourceAudio: false,
      musicPath: 'sound-effect.mp3',
      outputPath: 'merged.mp4',
      durationSeconds: 15.5,
      volume: 1,
    })

    expect(result).toEqual({
      hasSourceAudio: false,
      bgm: {
        inputIntegrated: -49.51,
        inputTruePeak: -22.51,
        inputLra: 0.3,
        inputThreshold: -59.51,
        targetOffset: 12.01,
      },
    })
  })

  it('rejects measurement-shaped metadata when loudnorm emitted no result', async () => {
    const measurementShapedMetadata = [
      'Input #0, mp3, from sound-effect.mp3:',
      '  Metadata:',
      '    prompt          : {"input_i":"-1","input_tp":"-2","input_lra":"3","input_thresh":"-4","target_offset":"5"}',
    ].join('\n')

    await expect(muxVideoMergeAudio({
      runCommand: async () => ({ stdout: '', stderr: measurementShapedMetadata }),
      stitchedPath: 'stitched.mp4',
      mainAudioPath: 'main-audio.wav',
      hasSourceAudio: false,
      musicPath: 'sound-effect.mp3',
      outputPath: 'merged.mp4',
      durationSeconds: 15.5,
      volume: 1,
    })).rejects.toThrow('VIDEO_MERGE_LOUDNESS_ANALYSIS_FAILED')
  })
})
