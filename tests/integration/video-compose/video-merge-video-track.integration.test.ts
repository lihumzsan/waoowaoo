import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runFfmpegCommand } from '@/lib/video-compose/ffmpeg-command'
import { resolveCompositionTiming } from '@/lib/video-compose/composition-timing'
import { composeVideoMergeVideoTrack } from '@/lib/video-compose/video-merge-ffmpeg'

const DURATION_SECONDS = 1

function timeline(count: number,durationMs=DURATION_SECONDS*1000,sourceStartMs=0) {
  return resolveCompositionTiming(
    {
      schemaVersion: 1,
      clips: Array.from({ length: count }, (_, index) => ({
        clipId: `clip-${index}`,
        source: { resourceId: `source-${index}`, contentVersion: 1 },
        sourceStartMs,
        durationMs,
      })),
      textLayers: [],
      audio: { mode: 'mute', musicCues: [], soundCues: [] },
      contextReferences: [],
    },
    '24/1',
  )
}

describe('video merge single-video track preparation', () => {
  let workspaceDir = ''

  afterEach(async () => {
    if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true })
    workspaceDir = ''
  })

  it('keeps a compatible H.264 single-video stream at its original frame rate', async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-video-merge-track-'))
    const sourcePath = path.join(workspaceDir, 'source.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=black:s=320x180:r=24:d=${String(DURATION_SECONDS)}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
    ], { stage: 'video_merge_track_test_source', expectedDurationSeconds: DURATION_SECONDS })

    const { stitchedPath: result } = await composeVideoMergeVideoTrack({
      sourcePaths: [sourcePath],
      timeline: timeline(1),
      workspaceDir,
      width: 320,
      height: 180,
    })
    const probe = await runFfmpegCommand('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,r_frame_rate',
      '-of', 'default=noprint_wrappers=1', result,
    ], { stage: 'video_merge_track_test_probe' })

    expect(probe.stdout).toContain('codec_name=h264')
    expect(probe.stdout).toContain('r_frame_rate=24/1')
  })

  it('uses the first clip frame rate as the multi-clip timeline authority', async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-video-merge-track-'))
    const firstPath = path.join(workspaceDir, 'first.mp4')
    const secondPath = path.join(workspaceDir, 'second.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=red:s=320x180:r=24:d=${String(DURATION_SECONDS)}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', firstPath,
    ], { stage: 'video_merge_track_first_test_source', expectedDurationSeconds: DURATION_SECONDS })
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=blue:s=320x180:r=30:d=${String(DURATION_SECONDS)}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', secondPath,
    ], { stage: 'video_merge_track_second_test_source', expectedDurationSeconds: DURATION_SECONDS })

    const { stitchedPath: result } = await composeVideoMergeVideoTrack({
      sourcePaths: [firstPath, secondPath],
      timeline: timeline(2),
      workspaceDir,
      width: 320,
      height: 180,
    })
    const probe = await runFfmpegCommand('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate',
      '-of', 'default=noprint_wrappers=1:nokey=1', result,
    ], { stage: 'video_merge_track_multi_test_probe' })

    expect(probe.stdout.trim()).toBe('24/1')
  })

  it('retains the covering source frame for off-grid starts and the final source interval', async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(),'wao-offgrid-frame-'))
    const sourcePath=path.join(workspaceDir,'source.mp4')
    await runFfmpegCommand('ffmpeg',[
      '-y','-f','lavfi','-i',"color=c=blue:s=160x90:r=24:d=2,drawbox=c=red:t=fill:enable='eq(mod(n,24),0)'",'-c:v','libx264','-g','24','-pix_fmt','yuv420p',sourcePath,
    ],{stage:'offgrid_frame_source',expectedDurationSeconds:2})
    for(const [startMs,durationMs,color] of [[10,21,'red'],[1970,30,'blue'],[1010,21,'red']] as const){
      const directory=path.join(workspaceDir,String(startMs));await mkdir(directory)
      const {stitchedPath}=await composeVideoMergeVideoTrack({sourcePaths:[sourcePath],timeline:timeline(1,durationMs,startMs),workspaceDir:directory,width:160,height:90})
      const rgb=path.join(directory,'frame.rgb')
      await runFfmpegCommand('ffmpeg',['-y','-i',stitchedPath,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo',rgb],{stage:'offgrid_frame_pixel',expectedDurationSeconds:1})
      const pixel=await readFile(rgb)
      expect(pixel[color==='red'?0:2]).toBeGreaterThan(240)
      expect(pixel[color==='red'?2:0]).toBeLessThan(10)
    }
  })

})
