import { describe, expect, it, vi } from 'vitest'
import { muxFinalRenderAudio, type FinalRenderAudioCommandRunner } from '@/lib/video-compose/final-render-audio'

function loudnormJson() {
  return [
    '{',
    '  "input_i": "-14.72",',
    '  "input_tp": "-1.22",',
    '  "input_lra": "6.30",',
    '  "input_thresh": "-25.05",',
    '  "target_offset": "0.00"',
    '}',
  ].join('\n')
}

describe('final render audio mix', () => {
  it('splits the main audio before sidechain ducking so the mix graph does not reuse one label twice', async () => {
    const runCommandMock = vi.fn<FinalRenderAudioCommandRunner>(async (command) => {
      if (command === 'ffmpeg') return { stdout: '', stderr: loudnormJson() }
      return { stdout: '', stderr: '' }
    })

    await muxFinalRenderAudio({
      runCommand: runCommandMock,
      stitchedPath: '/tmp/stitched.mp4',
      mainAudioPath: '/tmp/main-audio.m4a',
      hasSourceAudio: true,
      musicPath: '/tmp/bgm.mp3',
      outputPath: '/tmp/final.mp4',
      durationSeconds: 57,
      volume: 0.42,
    })

    const finalFfmpegCall = runCommandMock.mock.calls.find((call) => {
      const args = call[1]
      return call[0] === 'ffmpeg' && args.includes('-filter_complex') && args.includes('/tmp/final.mp4')
    })
    expect(finalFfmpegCall).toBeTruthy()
    const args = finalFfmpegCall?.[1] ?? []
    expect(args).not.toContain('-stream_loop')
    const filterComplexIndex = args.indexOf('-filter_complex')
    expect(filterComplexIndex).toBeGreaterThanOrEqual(0)
    const filterGraph = args[filterComplexIndex + 1]
    expect(filterGraph).toContain('[main_norm]asplit=2[main_mix][main_sidechain]')
    expect(filterGraph).toContain('[bgm_norm][main_sidechain]sidechaincompress=threshold=0.08:ratio=3:attack=80:release=450')
    expect(filterGraph).toContain('[main_mix][ducked_bgm]amix=inputs=2')
    expect(filterGraph).not.toContain('[bgm][main]sidechaincompress')
    expect(filterGraph).not.toContain('[main][ducked_bgm]amix')
  })
})
